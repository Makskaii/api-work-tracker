<?php

namespace Evolution\DevTaskAutomation;

use Bitrix\Main\Application;
use Bitrix\Main\Config\Option;
use Bitrix\Main\Loader;
use Throwable;

/** Targeted retries contain only new transitions that failed their first check. */
final class GuardRetry
{
    public const MODULE = 'evolution.dev.tasks';
    public const OPTION = 'wip_pending_v1';
    private const LOCK = 'evolution_dev_wip_pending';
    private const WORKFLOW_TEMPLATE_ID = 217;
    private static ?array $continuationExpected = null;
    private static ?array $continuationOutcome = null;

    /** StartWorkflow starts activities synchronously in the installed runtime. */
    public static function continuationAttempt(int $itemId): ?array
    {
        return (int)(self::$continuationExpected['id'] ?? 0) === $itemId ? self::$continuationExpected : null;
    }

    public static function recordContinuationOutcome(int $itemId, array $outcome): void
    {
        if (self::continuationAttempt($itemId) !== null) {
            self::$continuationOutcome = $outcome;
        }
    }

    public static function agent(): string
    {
        self::run();
        return '\\Evolution\\DevTaskAutomation\\GuardRetry::agent();';
    }

    /** Bounded runtime, not a scan or correction of existing In work duplicates. */
    public static function run(): array
    {
        $result = ['checked' => 0, 'reverted' => 0, 'pending' => 0, 'stale' => 0, 'continued' => 0, 'manualChecked' => 0];
        try {
            $queue = self::mutate(static function (array &$queue): array {
                return $queue;
            });
            uasort($queue, static function (array $a, array $b): int {
                return (int)$a['nextAt'] <=> (int)$b['nextAt'];
            });
            foreach ($queue as $entry) {
                if (($entry['continuation'] ?? '') !== '') {
                    // Administrative claims cannot consume the active retry
                    // budget or starve new transitions. Their stale cleanup is
                    // separately bounded, and never restarts the workflow.
                    if ($result['manualChecked'] < 10 && (int)$entry['nextAt'] <= time()) {
                        ++$result['manualChecked'];
                        $manual = (new WorkInProgressGuard())->check((int)$entry['fingerprint']['id'], (string)$entry['previousStageId'], $entry['fingerprint']);
                        if (!empty($manual['stale']) || !empty($manual['reverted'])) {
                            self::complete($entry['fingerprint']);
                        } else {
                            self::notify($entry['fingerprint'], 'Продолжение действий стадии требует проверки администратора; повторный запуск отключён, чтобы не создать дубли.', false, 'continuation');
                        }
                    }
                    continue;
                }
                if ($result['checked'] >= 10 || (int)$entry['nextAt'] > time()) {
                    continue;
                }
                ++$result['checked'];
                $outcome = (new WorkInProgressGuard())->check(
                    (int)$entry['fingerprint']['id'], (string)$entry['previousStageId'], $entry['fingerprint']
                );
                if (!empty($outcome['allowed'])) {
                    if (self::continueWorkflow($entry)) {
                        ++$result['continued'];
                    } else {
                        ++$result['pending'];
                    }
                    continue;
                }
                if (empty($outcome['retryNeeded'])) {
                    self::complete($entry['fingerprint']);
                    $result['reverted'] += !empty($outcome['reverted']) ? 1 : 0;
                    $result['stale'] += !empty($outcome['stale']) ? 1 : 0;
                } else {
                    ++$result['pending'];
                }
            }
        } catch (Throwable $exception) {
            self::log(0, 'Повторная проверка задач в работе не выполнена.');
            $result['error'] = 'retry_failed';
        }
        return $result;
    }

    public static function defer(array $fingerprint, string $previousStageId): void
    {
        if ((int)($fingerprint['historyId'] ?? 0) <= 0) {
            throw new \InvalidArgumentException('Повторная проверка требует подтверждённого перехода.');
        }
        self::mutate(static function (array &$queue) use ($fingerprint, $previousStageId): void {
            $id = (string)$fingerprint['id'];
            $key = GuardPolicy::attemptKey($fingerprint);
            $same = ($queue[$id]['key'] ?? '') === $key;
            $attempts = $same ? (int)$queue[$id]['attempts'] + 1 : 1;
            $queue[$id] = [
                'key' => $key, 'fingerprint' => $fingerprint,
                'previousStageId' => $previousStageId,
                'attempts' => $attempts,
                'nextAt' => time() + min(300, 30 * $attempts),
                'continuation' => $same ? ($queue[$id]['continuation'] ?? '') : '',
            ];
        });
    }

    /**
     * The first attempt closed before the original In work actions. A verified
     * retry that is now allowed starts that template once. Claim before starting:
     * an interrupted ambiguous start needs review rather than duplicate actions.
     */
    private static function continueWorkflow(array $entry): bool
    {
        $fingerprint = $entry['fingerprint'];
        if (!Loader::includeModule('bizproc')) {
            self::defer($fingerprint, (string)$entry['previousStageId']);
            return false;
        }
        $claimed = self::mutate(static function (array &$queue) use ($entry): bool {
            $id = (string)$entry['fingerprint']['id'];
            if (($queue[$id]['key'] ?? '') !== $entry['key'] || ($queue[$id]['continuation'] ?? '') !== '') {
                return false;
            }
            $queue[$id]['continuation'] = 'starting';
            return true;
        });
        if (!$claimed) {
            self::notify($fingerprint, 'Продолжение действий стадии требует проверки администратора; повторный запуск отключён, чтобы не создать дубли.', false, 'continuation');
            return false;
        }
        self::$continuationExpected = $fingerprint;
        self::$continuationOutcome = null;
        try {
            $errors = [];
            $workflowId = \CBPDocument::StartWorkflow(self::WORKFLOW_TEMPLATE_ID, [
                'crm', 'Bitrix\\Crm\\Integration\\BizProc\\Document\\Dynamic',
                'DYNAMIC_1072_' . (int)$fingerprint['id'],
            ], ['TargetUser' => 'user_' . (int)$fingerprint['assignee']], $errors);
            $outcome = self::$continuationOutcome;
            if (is_string($workflowId) && $workflowId !== '' && !empty($outcome['allowed'])) {
                self::complete($fingerprint);
                return true;
            }
            if ($outcome !== null && (!empty($outcome['stale']) || !empty($outcome['reverted']))) {
                self::complete($fingerprint);
                return false;
            }
            // If no workflow ID exists, StartWorkflow did not start; if the
            // guard ran and rejected, original actions were skipped. Both are safe
            // to retry. Unknown exceptions/status stay claimed for manual review.
            if (!$workflowId || ($outcome !== null && empty($outcome['allowed']))) {
                self::mutate(static function (array &$queue) use ($entry): void {
                    $id = (string)$entry['fingerprint']['id'];
                    if (($queue[$id]['key'] ?? '') === $entry['key']) {
                        $queue[$id]['continuation'] = '';
                    }
                });
                self::defer($fingerprint, (string)$entry['previousStageId']);
            } else {
                self::log((int)$fingerprint['id'], 'Результат продолжения действий стадии неизвестен; повторный запуск отключён.');
                self::notify($fingerprint, 'Не удалось подтвердить продолжение действий стадии. Обратитесь к администратору.', false, 'continuation');
            }
            return false;
        } catch (Throwable $exception) {
            self::log((int)$fingerprint['id'], 'Продолжение действий стадии прервано; повторный запуск отключён.');
            self::notify($fingerprint, 'Не удалось подтвердить продолжение действий стадии. Обратитесь к администратору.', false, 'continuation');
            return false;
        } finally {
            self::$continuationExpected = null;
            self::$continuationOutcome = null;
        }
    }

    /** A late attempt must not remove the pending record of a newer transition. */
    public static function complete(array $fingerprint): void
    {
        self::mutate(static function (array &$queue) use ($fingerprint): void {
            $id = (string)$fingerprint['id'];
            if (($queue[$id]['key'] ?? '') === GuardPolicy::attemptKey($fingerprint)) {
                unset($queue[$id]);
            }
        });
    }

    /** Serialize normal original actions against the retry continuation claim. */
    public static function completeNormalAttempt(array $fingerprint): bool
    {
        return self::mutate(static function (array &$queue) use ($fingerprint): bool {
            $id = (string)$fingerprint['id'];
            if (($queue[$id]['key'] ?? '') === GuardPolicy::attemptKey($fingerprint)) {
                if (($queue[$id]['continuation'] ?? '') !== '') {
                    return false;
                }
                unset($queue[$id]);
            }
            return true;
        });
    }

    public static function notify(array $fingerprint, string $reason, bool $reverted = false, string $state = 'pending'): bool
    {
        $id = (int)$fingerprint['id'];
        $assignee = (int)$fingerprint['assignee'];
        if ($assignee <= 0 || !Loader::includeModule('im')) {
            self::log($id, 'Не удалось показать ответственному результат проверки задачи.');
            return false;
        }
        $key = GuardPolicy::attemptKey($fingerprint);
        $tag = 'EVOLUTION_DEV_WIP|' . DeliveryMode::key() . '|' . $assignee . '|' . $key . '|' . ($reverted ? 'reverted' : $state);
        $connection = Application::getConnection();
        $lock = 'evolution_dev_wip_notice_' . substr(hash('sha256', $tag), 0, 20);
        if (!$connection->lock($lock, 0)) {
            return false;
        }
        try {
            $existing = \Bitrix\Im\Model\MessageTable::getList([
                'filter' => ['=NOTIFY_TAG' => $tag], 'select' => ['ID'], 'limit' => 1,
            ])->fetch();
            if ($existing) {
                return true;
            }
            $prefix = DeliveryMode::prefix($assignee);
            $message = $prefix . '[URL=/crm/type/1072/details/' . $id . '/]Задача №' . $id . '[/URL]: ' . $reason;
            $notificationId = \CIMNotify::Add([
                'TO_USER_ID' => DeliveryMode::target($assignee), 'NOTIFY_TYPE' => IM_NOTIFY_SYSTEM,
                'NOTIFY_MODULE' => 'bizproc', 'NOTIFY_EVENT' => 'activity',
                'NOTIFY_TAG' => $tag, 'NOTIFY_MESSAGE' => $message,
                'NOTIFY_MESSAGE_OUT' => strip_tags(str_replace(['[b]', '[/b]'], '', $prefix)) . 'Задача №' . $id . ': ' . $reason,
                'PUSH_MESSAGE' => $reverted ? 'Задача возвращена: уже есть другая задача в работе' : 'Не удалось проверить начало работы над задачей',
            ]);
            if (!is_numeric($notificationId) || (int)$notificationId <= 0) {
                self::log($id, 'Не удалось показать ответственному результат проверки задачи.');
                return false;
            }
            return true;
        } finally {
            $connection->unlock($lock);
        }
    }

    /** Fixed diagnostic text only: no SQL, auth values or exception dumps. */
    public static function log(int $id, string $message): void
    {
        if (class_exists('CEventLog')) {
            \CEventLog::Add([
                'SEVERITY' => 'ERROR', 'AUDIT_TYPE_ID' => 'EVOLUTION_DEV_TASK_WIP',
                'MODULE_ID' => 'crm', 'ITEM_ID' => (string)$id, 'DESCRIPTION' => $message,
            ]);
        }
    }

    private static function mutate(callable $callback)
    {
        $connection = Application::getConnection();
        if (!$connection->lock(self::LOCK, 2)) {
            throw new \RuntimeException('Не удалось заблокировать очередь повторных проверок.');
        }
        try {
            $raw = Option::get(self::MODULE, self::OPTION, '');
            $state = $raw === '' ? ['version' => 1, 'queue' => []] : json_decode($raw, true);
            if (!is_array($state) || ($state['version'] ?? null) !== 1 || !is_array($state['queue'] ?? null)) {
                throw new \RuntimeException('Очередь повторных проверок повреждена.');
            }
            $queue = $state['queue'];
            $original = $queue;
            $result = $callback($queue);
            if ($queue !== $original) {
                Option::set(self::MODULE, self::OPTION, json_encode(['version' => 1, 'queue' => $queue], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
            }
            return $result;
        } finally {
            $connection->unlock(self::LOCK);
        }
    }
}
