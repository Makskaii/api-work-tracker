<?php

namespace Evolution\DevTaskAutomation;

use Bitrix\Main\Application;
use Bitrix\Main\Config\Option;
use Bitrix\Main\Loader;
use DateTimeImmutable;
use DateTimeZone;
use RuntimeException;
use Throwable;

final class Notifications
{
    public const MODULE = 'evolution.dev.tasks';
    public const STATE_OPTION = 'notification_state_v1';
    public const LOCK_NAME = 'evolution_dev_task_notifications';
    public const TASK_TYPE = 1072;
    public const REPORT_TYPE = 1060;
    public const DEVELOPMENT_DEPARTMENT = 23;
    public const SETTERS_FIELD = 'UF_CRM_14_1773214976';
    public const REDLINE_FIELD = 'UF_CRM_14_1778663165471';
    public const ESTIMATE_FIELD = 'UF_CRM_14_1770731674952';
    public const SOLD_FIELD = 'UF_CRM_14_1776177413413';
    public const REPORT_HOURS_FIELD = 'UF_CRM_11_1770627880479';

    public static function agent(): string
    {
        self::run();
        return '\\Evolution\\DevTaskAutomation\\Notifications::agent();';
    }

    /** dryRun performs reads only: no CIM messages, Option writes or changes to tasks. */
    public static function run(?DateTimeImmutable $now = null, bool $dryRun = false): array
    {
        $now = $now ?? new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
        $result = ['dryRun' => $dryRun, 'tasks' => 0, 'reports' => 0, 'digests' => [], 'sent' => 0, 'failed' => 0];
        $connection = null;
        $locked = false;
        try {
            if (!Loader::includeModule('crm') || !Loader::includeModule('im')) {
                throw new RuntimeException('Required CRM/IM module is unavailable');
            }
            $connection = Application::getConnection();
            if (!$dryRun) {
                $locked = $connection->lock(self::LOCK_NAME, 0);
                if (!$locked) {
                    $result['skipped'] = 'scan_already_running';
                    return $result;
                }
            }
            // Configuration uses the same lock; capture routing only after it is acquired.
            // One scan must use the same mode for recipients, tags, prefixes and state.
            $modeKey = DeliveryMode::key();
            $result['mode'] = $modeKey === 'live' ? 'live' : 'preview';
            $result['modeKey'] = $modeKey;
            $stateOption = self::stateOption($modeKey);
            $originalState = self::readState($stateOption);
            $tasks = self::readTasks();
            $result['tasks'] = count($tasks);
            $checking = self::readCheckHandoffs($tasks);
            $result['checkingTasks'] = $checking['taskCount'];
            $result['checkingHistoryKnown'] = count($checking['handoffs']);
            $result['checkingHistoryUnknown'] = $checking['taskCount'] - count($checking['handoffs']);
            if (isset($checking['error'])) {
                $result['historyWarning'] = $checking['error'];
                if (!$dryRun) {
                    self::log('Check stage history unavailable; late handoff accusations skipped');
                }
            }
            foreach ($tasks as &$task) {
                $task['checkHandoff'] = $checking['handoffs'][$task['id']] ?? null;
            }
            unset($task);
            $actuals = self::readActuals(array_column($tasks, 'id'));
            $result['reports'] = $actuals['reportCount'];
            $result['invalidReportHours'] = $actuals['invalidHours'];
            foreach ($tasks as &$task) {
                $task['actual'] = $actuals['hours'][$task['id']] ?? 0.0;
            }
            unset($task);
            $headId = self::headId();
            $result['headId'] = $headId;
            if ($headId === 0) {
                $result['warning'] = 'development_head_unavailable';
                if (!$dryRun) {
                    self::log('Development department has no active head; other recipients still receive alerts');
                }
            }
            $evaluation = NotificationPolicy::evaluate($tasks, $headId, $originalState, $now);
            $state = $evaluation['state'];
            $currentByUser = [];
            foreach ($evaluation['digests'] as $digest) {
                $currentByUser[$digest['userId']] = $digest;
            }
            foreach ($state['pendingDigests'] as $userId => $pending) {
                if (!NotificationPolicy::pendingIsCurrent((array)$pending, $currentByUser[(int)$userId] ?? null)) {
                    // Never resume developer pages after Check, corrected limits, or task completion.
                    unset($state['pendingDigests'][$userId]);
                }
            }
            $activeUsers = self::activeUsers(array_column($evaluation['digests'], 'userId'));
            foreach ($evaluation['digests'] as $digest) {
                if (!isset($activeUsers[$digest['userId']])) {
                    continue;
                }
                $pending = $state['pendingDigests'][(string)$digest['userId']] ?? null;
                $actualTarget = DeliveryMode::target($digest['userId'], $modeKey);
                if ($pending !== null) {
                    $parts = $pending['parts'];
                } else {
                    $prefix = DeliveryMode::prefix($digest['userId'], $modeKey);
                    $budget = 18000 - max(200, mb_strlen($prefix));
                    $parts = array_map(static function (string $part) use ($prefix): string {
                        return $prefix . $part;
                    }, self::renderParts($digest, $now, $budget));
                }
                $result['digests'][] = [
                    'userId' => $digest['userId'], 'intendedUserId' => $digest['userId'],
                    'actualTargetUserId' => $actualTarget, 'taskCount' => count($digest['tasks']),
                    'deadline' => $digest['deadlineDay'] !== null,
                    'overrunCount' => count($digest['overrunMarks']), 'partCount' => count($parts),
                    'lateHandoffCount' => count($digest['handoffMarks']),
                    'message' => implode("\n\n", $parts),
                ];
                if ($dryRun) {
                    continue;
                }
                if ($pending === null) {
                    // Freeze all page bodies before sending the first page. This also makes
                    // an interrupted scan retry exact tags even if actual hours grow meanwhile.
                    $pending = [
                        'userId' => $digest['userId'], 'key' => $digest['key'],
                        'partCount' => count($parts), 'parts' => $parts,
                    ];
                    $state['pendingDigests'][(string)$digest['userId']] = $pending;
                    self::writeState($state, $stateOption);
                }
                // A successful delivery is persisted immediately; failed people retry next scan.
                // The IM tag closes the crash window between Add and the Option update.
                $allPartsDelivered = true;
                foreach ($parts as $index => $message) {
                    $tag = 'EVOLUTION_DEV_TASKS|' . $modeKey . '|' . $digest['userId'] . '|' . $digest['key']
                        . '|' . ($index + 1) . '|' . hash('sha256', $message);
                    $existing = \Bitrix\Im\Model\MessageTable::getList([
                        'filter' => ['=NOTIFY_TAG' => $tag], 'select' => ['ID'], 'limit' => 1,
                    ])->fetch();
                    $notificationId = $existing ? (int)$existing['ID'] : \CIMNotify::Add([
                        'TO_USER_ID' => $actualTarget,
                        'NOTIFY_TYPE' => IM_NOTIFY_SYSTEM,
                        'NOTIFY_MODULE' => 'bizproc', 'NOTIFY_EVENT' => 'activity',
                        'NOTIFY_TAG' => $tag, 'NOTIFY_MESSAGE' => $message,
                        'NOTIFY_MESSAGE_OUT' => self::plain($message),
                        'PUSH_MESSAGE' => 'Задачи разработки: сроки и перерасход часов',
                    ]);
                    if (!is_numeric($notificationId) || (int)$notificationId <= 0) {
                        $allPartsDelivered = false;
                        $result['failed']++;
                        self::log('Notification page ' . ($index + 1) . ' delivery failed for user ' . $digest['userId']);
                        break;
                    }
                }
                if (!$allPartsDelivered) {
                    continue;
                }
                $state = NotificationPolicy::delivered($state, $digest);
                unset($state['pendingDigests'][(string)$digest['userId']]);
                self::writeState($state, $stateOption);
                $result['sent']++;
            }
            // Persist rearming even when nothing was delivered this run.
            if (!$dryRun && $state !== $originalState) {
                self::writeState($state, $stateOption);
            }
        } catch (Throwable $error) {
            $result['error'] = $error->getMessage();
            if (!$dryRun) {
                self::log('Notification scan failed: ' . $error->getMessage());
            }
        } finally {
            if ($locked && $connection) {
                $connection->unlock(self::LOCK_NAME);
            }
        }
        return $result;
    }

    public static function stateOption(string $modeKey): string
    {
        return self::STATE_OPTION . '_' . $modeKey;
    }

    private static function readState(string $stateOption): array
    {
        $raw = Option::get(self::MODULE, $stateOption, '');
        if ($raw === '') {
            return [];
        }
        $state = json_decode($raw, true);
        // Fail closed on corrupted state rather than replaying all historical alerts.
        if (!is_array($state) || ($state['version'] ?? null) !== 1) {
            throw new RuntimeException('Notification state is invalid; repair state before scanning');
        }
        return $state;
    }

    private static function writeState(array $state, string $stateOption): void
    {
        $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
        Option::set(self::MODULE, $stateOption, $encoded);
    }

    private static function readTasks(): array
    {
        $factory = \Bitrix\Crm\Service\Container::getInstance()->getFactory(self::TASK_TYPE);
        if (!$factory) {
            throw new RuntimeException('Development smart process is unavailable');
        }
        $tasks = [];
        $lastId = 0;
        do {
            $items = $factory->getItems([
                'filter' => ['>ID' => $lastId, '!@STAGE_ID' => array_merge(
                    NotificationPolicy::CLOSED_STAGES, NotificationPolicy::IGNORED_STAGES
                )],
                'select' => ['ID', 'TITLE', 'ASSIGNED_BY_ID', 'STAGE_ID', 'CATEGORY_ID', self::SETTERS_FIELD,
                    self::REDLINE_FIELD, self::ESTIMATE_FIELD, self::SOLD_FIELD],
                'order' => ['ID' => 'ASC'], 'limit' => 500,
            ]);
            foreach ($items as $item) {
                $lastId = (int)$item->getId();
                $task = [
                    'id' => $lastId, 'title' => $item->getTitle(), 'stage' => $item->getStageId(),
                    'category' => (int)$item->get('CATEGORY_ID'),
                    'assignee' => $item->getAssignedById(), 'setters' => (array)$item->get(self::SETTERS_FIELD),
                    'redline' => NotificationPolicy::date($item->get(self::REDLINE_FIELD)),
                    'estimate' => $item->get(self::ESTIMATE_FIELD), 'sold' => $item->get(self::SOLD_FIELD),
                ];
                if (!NotificationPolicy::isNotificationExcluded($task)) {
                    $tasks[] = $task;
                }
            }
        } while (count($items) === 500);
        return $tasks;
    }

    private static function readCheckHandoffs(array $tasks): array
    {
        $checking = [];
        foreach ($tasks as $task) {
            if ($task['stage'] === NotificationPolicy::CHECK_STAGE) {
                $checking[$task['id']] = $task;
            }
        }
        $result = ['taskCount' => count($checking), 'handoffs' => []];
        if ($checking === []) {
            return $result;
        }
        try {
            foreach (array_chunk(array_keys($checking), 250) as $ids) {
                // Query entries for all stages. Filtering to Check would resurrect an older visit.
                $entries = \Bitrix\Crm\History\Entity\EntityStageHistoryTable::getList([
                    'filter' => ['=OWNER_TYPE_ID' => self::TASK_TYPE, '@OWNER_ID' => $ids],
                    'select' => ['ID', 'OWNER_ID', 'OWNER_TYPE_ID', 'TYPE_ID', 'STAGE_ID', 'CATEGORY_ID', 'CREATED_TIME'],
                    'order' => ['ID' => 'DESC'],
                ]);
                $latest = [];
                while ($entry = $entries->fetch()) {
                    $owner = (int)$entry['OWNER_ID'];
                    if (!isset($latest[$owner])) {
                        $latest[$owner] = $entry;
                    }
                    if (count($latest) === count($ids)) {
                        break;
                    }
                }
                foreach ($ids as $id) {
                    $visit = NotificationPolicy::currentCheckVisit($checking[$id], isset($latest[$id]) ? [$latest[$id]] : []);
                    if ($visit !== null) {
                        $result['handoffs'][$id] = $visit;
                    }
                }
            }
        } catch (Throwable $error) {
            // The analyst/head review reminder remains usable when history is temporarily absent.
            $result['handoffs'] = [];
            $result['error'] = 'check_stage_history_unavailable';
        }
        return $result;
    }

    private static function readActuals(array $taskIds): array
    {
        $factory = \Bitrix\Crm\Service\Container::getInstance()->getFactory(self::REPORT_TYPE);
        if (!$factory) {
            throw new RuntimeException('Daily reports smart process is unavailable');
        }
        $result = ['hours' => [], 'reportCount' => 0, 'invalidHours' => 0];
        foreach (array_chunk($taskIds, 250) as $chunk) {
            $lastId = 0;
            do {
                // All effort counts, including reports hidden from the client PDF.
                $items = $factory->getItems([
                    'filter' => ['>ID' => $lastId, '@PARENT_ID_1072' => $chunk],
                    'select' => ['ID', 'PARENT_ID_1072', self::REPORT_HOURS_FIELD],
                    'order' => ['ID' => 'ASC'], 'limit' => 500,
                ]);
                foreach ($items as $item) {
                    $lastId = (int)$item->getId();
                    $taskId = (int)$item->get('PARENT_ID_1072');
                    $hours = NotificationPolicy::hours($item->get(self::REPORT_HOURS_FIELD));
                    $result['reportCount']++;
                    if ($hours === null) {
                        $result['invalidHours']++;
                        continue;
                    }
                    $result['hours'][$taskId] = ($result['hours'][$taskId] ?? 0.0) + $hours;
                }
            } while (count($items) === 500);
        }
        return $result;
    }

    private static function headId(): int
    {
        if (!Loader::includeModule('iblock') || !Loader::includeModule('intranet')) {
            return 0;
        }
        $structure = (int)Option::get('intranet', 'iblock_structure', 0);
        if ($structure <= 0) {
            return 0;
        }
        $department = \CIBlockSection::GetList([], [
            'IBLOCK_ID' => $structure, 'ID' => self::DEVELOPMENT_DEPARTMENT,
        ], false, ['ID', 'UF_HEAD'])->Fetch();
        $headId = (int)($department['UF_HEAD'] ?? 0);
        if ($headId <= 0) {
            return 0;
        }
        $user = \CUser::GetByID($headId)->Fetch();
        return $user && $user['ACTIVE'] === 'Y' ? $headId : 0;
    }

    private static function activeUsers(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $by = 'id';
        $order = 'asc';
        $users = \CUser::GetList($by, $order, [
            'ID' => implode('|', array_unique(array_map('intval', $ids))), 'ACTIVE' => 'Y',
        ], ['FIELDS' => ['ID', 'ACTIVE']]);
        $active = [];
        while ($user = $users->Fetch()) {
            $active[(int)$user['ID']] = true;
        }
        return $active;
    }

    public static function render(array $digest, DateTimeImmutable $now): string
    {
        $rows = [];
        foreach ($digest['tasks'] as $task) {
            $rows[] = self::renderTask($task);
        }
        return self::header($now) . "\n\n" . implode("\n\n", $rows);
    }

    /** Complete task rows; leave a margin below CIMMessenger's 20,000-character limit. */
    public static function renderParts(array $digest, DateTimeImmutable $now, int $maxCharacters = 18000): array
    {
        if ($maxCharacters < 1000) {
            throw new RuntimeException('Notification page budget is too small');
        }
        $header = self::header($now);
        $budget = $maxCharacters - 100; // Reserve room for the page number.
        $batches = [];
        $rows = [];
        $length = mb_strlen($header) + 2;
        $bytes = strlen($header) + 2;
        foreach ($digest['tasks'] as $task) {
            $row = self::renderTask($task);
            $rowLength = mb_strlen($row);
            if (mb_strlen($header) + 2 + $rowLength > $budget || strlen($header) + 2 + strlen($row) > 54000) {
                throw new RuntimeException('One notification task row exceeds the page budget');
            }
            if ($rows !== [] && ($length + 2 + $rowLength > $budget || $bytes + 2 + strlen($row) > 54000)) {
                $batches[] = $rows;
                $rows = [];
                $length = mb_strlen($header) + 2;
                $bytes = strlen($header) + 2;
            }
            $length += ($rows === [] ? 0 : 2) + $rowLength;
            $bytes += ($rows === [] ? 0 : 2) + strlen($row);
            $rows[] = $row;
        }
        if ($rows !== []) {
            $batches[] = $rows;
        }
        $parts = [];
        foreach ($batches as $index => $batch) {
            $pageHeader = $header;
            if (count($batches) > 1) {
                $pageHeader .= "\nЧасть " . ($index + 1) . ' из ' . count($batches);
            }
            $parts[] = $pageHeader . "\n\n" . implode("\n\n", $batch);
        }
        return $parts;
    }

    private static function header(DateTimeImmutable $now): string
    {
        return '[b]Задачи разработки · '
            . $now->setTimezone(new DateTimeZone('Europe/Moscow'))->format('d.m.Y') . '[/b]';
    }

    private static function renderTask(array $task): string
    {
        $title = self::text($task['title']);
        if (mb_strlen($title) > 250) {
            $title = mb_substr($title, 0, 249) . '…';
        }
        $lines = ['[url=/crm/type/1072/details/' . (int)$task['id'] . '/]' . $title . '[/url]'];
        if ($task['stage'] === NotificationPolicy::CHECK_STAGE) {
            $lines[] = 'На проверке у аналитиков.';
        }
        foreach ($task['reasons'] as $kind => $reason) {
            if ($kind === 'deadline') {
                $redline = DateTimeImmutable::createFromFormat('!Y-m-d', $task['redline'])->format('d.m.Y');
                if (in_array($reason['kind'], ['review_due', 'review_overdue'], true)) {
                    $lines[] = 'Задача ожидает проверки у аналитика.';
                    $lines[] = $reason['kind'] === 'review_due'
                        ? 'Сегодня редлайн: ' . $redline . '.'
                        : 'Редлайн ' . $redline . ' прошёл ' . $reason['days'] . ' дн. назад; ожидается проверка.';
                    if ($reason['handedOffOn'] !== null) {
                        $handoff = DateTimeImmutable::createFromFormat('!Y-m-d', $reason['handedOffOn'])->format('d.m.Y');
                        $lines[] = 'Передана на проверку: ' . $handoff . '.';
                        if ($reason['handoffTiming'] === 'timely') {
                            $lines[] = 'Разработчик передал задачу в срок.';
                        }
                    }
                } else {
                    $lines[] = $reason['kind'] === 'due'
                        ? 'Сегодня редлайн: ' . $redline . '.'
                        : 'Редлайн ' . $redline . ' просрочен на ' . $reason['days'] . ' дн.';
                }
            } elseif ($kind === 'late_handoff') {
                $redline = DateTimeImmutable::createFromFormat('!Y-m-d', $task['redline'])->format('d.m.Y');
                $handoff = DateTimeImmutable::createFromFormat('!Y-m-d', $reason['handedOffOn'])->format('d.m.Y');
                $lines[] = 'Передана на проверку ' . $handoff . ' после редлайна ' . $redline . '.';
                $lines[] = $reason['action'] === 'write_comment'
                    ? 'Пожалуйста, напишите в комментарии к задаче причину задержки.'
                    : 'Попросите разработчика написать в комментарии к задаче причину задержки.';
            } else {
                $label = $kind === 'estimate' ? 'Текущая оценка' : 'Лимит часов для клиента';
                $lines[] = $label . ': факт ' . self::number($reason['actual'])
                    . ' / ' . self::number($reason['limit']) . ' ч; перерасход '
                    . self::number($reason['overrun']) . ' ч.';
            }
        }
        return implode("\n", $lines);
    }

    private static function text(string $value): string
    {
        // A task title must not introduce IM BBCode links or mentions.
        return str_replace(['[', ']', "\r", "\n"], ['［', '］', '', ' '], $value);
    }

    private static function number(float $number): string
    {
        return str_replace('.', ',', rtrim(rtrim(number_format($number, 2, '.', ''), '0'), '.'));
    }

    private static function plain(string $message): string
    {
        return (string)preg_replace('/\[\/?(?:b|url)(?:=[^\]]*)?\]/i', '', $message);
    }

    private static function log(string $message): void
    {
        if (function_exists('AddMessage2Log')) {
            \AddMessage2Log($message, self::MODULE);
        }
    }
}
