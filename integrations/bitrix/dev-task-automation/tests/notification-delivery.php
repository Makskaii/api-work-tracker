<?php
declare(strict_types=1);

/** Isolated adapter simulation. Every Bitrix/IM/Option class below is a local fake. */
namespace Bitrix\Main\Config {
    final class Option {
        public static array $values = [];
        public static int $writes = 0;
        public static function get(string $module, string $name, string $default = ''): string {
            return self::$values[$module . '/' . $name] ?? $default;
        }
        public static function set(string $module, string $name, string $value): void {
            self::$values[$module . '/' . $name] = $value; self::$writes++;
        }
    }
}
namespace Bitrix\Main {
    final class Loader { public static function includeModule(string $module): bool { return true; } }
    final class Application {
        public static $onLock = null;
        public static function getConnection(): object {
            return new class {
                public function lock(string $name, int $timeout): bool {
                    if (Application::$onLock !== null) {
                        $callback = Application::$onLock;
                        Application::$onLock = null;
                        $callback();
                    }
                    return true;
                }
                public function unlock(string $name): bool { return true; }
            };
        }
    }
}
namespace Bitrix\Crm\Service {
    final class Container {
        public static function getInstance(): self { return new self(); }
        public function getFactory(int $type): object { return new \FakeNotificationFactory($type); }
    }
}
namespace Bitrix\Im\Model {
    final class MessageTable {
        public static function getList(array $parameters): object {
            $tag = $parameters['filter']['=NOTIFY_TAG'];
            foreach (\CIMNotify::$messages as $index => $message) {
                if ($message['NOTIFY_TAG'] === $tag) { return new \FakeNotificationResult([['ID' => $index + 1]]); }
            }
            return new \FakeNotificationResult([]);
        }
    }
}
namespace Bitrix\Crm\History\Entity {
    final class EntityStageHistoryTable {
        public static array $entries = [];
        public static function getList(array $parameters): object {
            if (isset($parameters['filter']['@TYPE_ID'])) {
                throw new \RuntimeException('History query must not hide newer finalization/category entries');
            }
            $entries = array_values(array_filter(self::$entries, static function (array $entry) use ($parameters): bool {
                return $entry['OWNER_TYPE_ID'] === $parameters['filter']['=OWNER_TYPE_ID']
                    && in_array($entry['OWNER_ID'], $parameters['filter']['@OWNER_ID'], true);
            }));
            usort($entries, static function (array $a, array $b): int { return $b['ID'] <=> $a['ID']; });
            return new \FakeNotificationResult($entries);
        }
    }
}
namespace {
    use Bitrix\Main\Config\Option;
    use Evolution\DevTaskAutomation\DeliveryMode;
    use Evolution\DevTaskAutomation\NotificationPolicy;
    use Evolution\DevTaskAutomation\Notifications;

    define('IM_NOTIFY_SYSTEM', 4);
    final class FakeNotificationResult {
        private array $rows;
        public function __construct(array $rows) { $this->rows = $rows; }
        public function Fetch() { return array_shift($this->rows) ?: false; }
    }
    final class FakeNotificationItem {
        private array $data;
        public function __construct(array $data) { $this->data = $data; }
        public function getId(): int { return $this->data['ID']; }
        public function getTitle(): string { return $this->data['TITLE'] ?? ''; }
        public function getStageId(): string { return $this->data['STAGE_ID'] ?? ''; }
        public function getAssignedById(): int { return $this->data['ASSIGNED_BY_ID'] ?? 0; }
        public function get(string $field) { return $this->data[$field] ?? null; }
    }
    final class FakeNotificationFactory {
        public static array $taskOverrides = [];
        public static float $reportHours = 25.0;
        public static array $queries = [];
        public static bool $respectStageFilter = true;
        private int $type;
        public function __construct(int $type) { $this->type = $type; }
        public function getItems(array $parameters): array {
            self::$queries[] = ['type' => $this->type, 'filter' => $parameters['filter']];
            $data = $this->type === 1072 ? [
                'ID' => 100, 'TITLE' => 'Проверка доставки', 'STAGE_ID' => 'DT1072_18:CLIENT',
                'ASSIGNED_BY_ID' => 50, 'CATEGORY_ID' => 18, 'UF_CRM_14_1773214976' => [40],
                'UF_CRM_14_1778663165471' => '2026-10-02',
                'UF_CRM_14_1770731674952' => '10', 'UF_CRM_14_1776177413413' => 20,
            ] : ['ID' => 200, 'PARENT_ID_1072' => 100, 'UF_CRM_11_1770627880479' => self::$reportHours];
            if ($this->type === 1072) {
                $data = array_replace($data, self::$taskOverrides);
                if (self::$respectStageFilter && in_array($data['STAGE_ID'], $parameters['filter']['!@STAGE_ID'] ?? [], true)) {
                    return [];
                }
            } elseif (!in_array($data['PARENT_ID_1072'], $parameters['filter']['@PARENT_ID_1072'] ?? [], true)) {
                return [];
            }
            return $data['ID'] > ($parameters['filter']['>ID'] ?? 0) ? [new FakeNotificationItem($data)] : [];
        }
    }
    final class CIBlockSection {
        public static function GetList($order, $filter, $count, $fields): FakeNotificationResult {
            return new FakeNotificationResult([['ID' => 23, 'UF_HEAD' => 3]]);
        }
    }
    final class CUser {
        public static function GetByID(int $id): FakeNotificationResult {
            return new FakeNotificationResult([['ID' => $id, 'ACTIVE' => 'Y', 'NAME' => 'Имя', 'LAST_NAME' => (string)$id]]);
        }
        public static function GetList(&$by, &$order, $filter, $parameters): FakeNotificationResult {
            $rows = [];
            foreach (explode('|', $filter['ID']) as $id) { $rows[] = ['ID' => (int)$id, 'ACTIVE' => 'Y']; }
            return new FakeNotificationResult($rows);
        }
    }
    final class CIMNotify {
        public static array $messages = [];
        public static function Add(array $fields): int { self::$messages[] = $fields; return count(self::$messages); }
    }
    function deliveryAssert($actual, $expected, string $message): void {
        if ($actual !== $expected) { throw new \RuntimeException($message . ': ' . var_export($actual, true)); }
    }
    require dirname(__DIR__) . '/bootstrap.php';
    Option::set('intranet', 'iblock_structure', '16');
    $now = new \DateTimeImmutable('2026-10-01 09:00', new \DateTimeZone('Europe/Moscow'));
    $writes = Option::$writes;
    $dry = Notifications::run($now, true);
    deliveryAssert($dry['mode'], 'preview', 'Preview is the safe default');
    deliveryAssert(array_unique(array_column($dry['digests'], 'actualTargetUserId')), [3], 'All dry-run targets are Artem');
    deliveryAssert(array_column($dry['digests'], 'intendedUserId'), [3, 40, 50], 'Would-be recipients remain inspectable');
    deliveryAssert(Option::$writes, $writes, 'Dry run writes no Option values');
    deliveryAssert(CIMNotify::$messages, [], 'Dry run sends nothing');

    $preview = Notifications::run($now);
    deliveryAssert($preview['sent'], 3, 'One labelled preview per would-be recipient');
    deliveryAssert(array_unique(array_column(CIMNotify::$messages, 'TO_USER_ID')), [3], 'No developer or setter receives a preview');
    foreach (CIMNotify::$messages as $message) {
        deliveryAssert(strpos($message['NOTIFY_TAG'], '|preview_3|') !== false, true, 'Tags isolate preview deliveries');
        deliveryAssert(strpos($message['NOTIFY_MESSAGE'], 'Проверка уведомлений') !== false, true, 'Preview label included');
        deliveryAssert(strpos($message['NOTIFY_MESSAGE'], 'Получатель в рабочем режиме:') !== false, true, 'Would-be recipient named');
        deliveryAssert(mb_strlen($message['NOTIFY_MESSAGE']) <= 18000, true, 'Preview prefix stays inside page budget');
    }
    deliveryAssert(Notifications::run($now)['sent'], 0, 'Preview crossing is not resent every minute');
    deliveryAssert(isset(Option::$values['evolution.dev.tasks/notification_state_v1_preview_3']), true, 'Preview state has its own namespace');
    deliveryAssert(isset(Option::$values['evolution.dev.tasks/notification_state_v1_live']), false, 'Preview never creates live state');

    // A local fake-mode switch verifies future live state without any real recipients or CRM.
    Option::set('evolution.dev.tasks', 'delivery_mode', 'live');
    $liveDry = Notifications::run($now, true);
    deliveryAssert($liveDry['mode'], 'live', 'Explicit future live configuration is distinguishable');
    deliveryAssert(array_column($liveDry['digests'], 'actualTargetUserId'), [3, 40, 50], 'Preview state has not suppressed future live conditions');
    deliveryAssert(count(CIMNotify::$messages), 3, 'Live dry run still sends nothing');
    deliveryAssert($liveDry['digests'][0]['message'][0] === '[', true, 'Normal digest rendered');
    deliveryAssert(strpos($liveDry['digests'][0]['message'], 'Проверка уведомлений') === false, true, 'Preview label absent from future live output');

    $previewState = Option::$values['evolution.dev.tasks/notification_state_v1_preview_3'];
    $live = Notifications::run($now);
    deliveryAssert($live['sent'], 3, 'Local live simulation sends to every intended recipient');
    $liveMessages = array_slice(CIMNotify::$messages, 3);
    deliveryAssert(array_column($liveMessages, 'TO_USER_ID'), [3, 40, 50], 'Actual live targets are head, setter and developer');
    foreach ($liveMessages as $message) {
        deliveryAssert(strpos($message['NOTIFY_TAG'], '|live|') !== false, true, 'Live tags have their own namespace');
        deliveryAssert(strpos($message['NOTIFY_MESSAGE'], 'Проверка уведомлений') === false, true, 'Live messages have no preview label');
        deliveryAssert(strpos($message['NOTIFY_MESSAGE'], 'Получатель в рабочем режиме:') === false, true, 'Live messages have no preview recipient heading');
    }
    deliveryAssert(Option::$values['evolution.dev.tasks/notification_state_v1_preview_3'], $previewState, 'Actual live delivery preserves preview state');
    deliveryAssert(isset(Option::$values['evolution.dev.tasks/notification_state_v1_live']), true, 'Actual live delivery persists its own ledger');
    deliveryAssert(Notifications::run($now)['sent'], 0, 'Actual live deliveries deduplicate on the next scan');
    deliveryAssert(count(CIMNotify::$messages), 6, 'No duplicate actual live message');

    // An old pending message is discarded when the task returns to the unformed stage.
    $state = json_decode(Option::$values['evolution.dev.tasks/notification_state_v1_live'], true, 512, JSON_THROW_ON_ERROR);
    $state['pendingDigests']['50'] = [
        'userId' => 50, 'key' => 'old-active-task', 'partCount' => 1, 'parts' => ['Old active task message'],
    ];
    $state['handoffAlerts']['100'] = ['signature' => 'old-check-visit', 'sentTo' => []];
    Option::set('evolution.dev.tasks', 'notification_state_v1_live', json_encode($state, JSON_THROW_ON_ERROR));
    FakeNotificationFactory::$taskOverrides = [
        'STAGE_ID' => NotificationPolicy::IGNORED_STAGES[0], 'UF_CRM_14_1778663165471' => '2026-09-01',
    ];
    $draftNow = new \DateTimeImmutable('2026-10-01 10:00', new \DateTimeZone('Europe/Moscow'));
    foreach ([true, false] as $respectFilter) {
        // Exercise both the native query boundary and a provider ignoring its filter.
        FakeNotificationFactory::$respectStageFilter = $respectFilter;
        FakeNotificationFactory::$queries = [];
        $ignored = Notifications::run($draftNow);
        deliveryAssert($ignored['tasks'], 0, 'Unformed tasks do not enter notification evaluation');
        deliveryAssert($ignored['reports'], 0, 'Unformed task effort is not loaded');
        deliveryAssert($ignored['digests'], [], 'Unformed task has no overdue or overrun digest');
        deliveryAssert(array_column(FakeNotificationFactory::$queries, 'type'), [1072], 'No report query runs for an ignored task');
        $excluded = FakeNotificationFactory::$queries[0]['filter']['!@STAGE_ID'];
        deliveryAssert(in_array(NotificationPolicy::IGNORED_STAGES[0], $excluded, true), true, 'Native query excludes verified unformed stage');
        deliveryAssert(in_array('DT1072_18:UC_L2I5S0', $excluded, true), false, 'Native query keeps Hold');
        deliveryAssert(count(CIMNotify::$messages), 6, 'Old pending draft message is not delivered');
    }
    $cleaned = json_decode(Option::$values['evolution.dev.tasks/notification_state_v1_live'], true, 512, JSON_THROW_ON_ERROR);
    deliveryAssert($cleaned['pendingDigests'], [], 'Move to unformed removes pending pages');
    deliveryAssert($cleaned['thresholds'], [], 'Move to unformed removes old overrun state');
    deliveryAssert($cleaned['handoffAlerts'], [], 'Move to unformed removes old Check accusation state');

    FakeNotificationFactory::$respectStageFilter = true;
    FakeNotificationFactory::$taskOverrides = [
        'STAGE_ID' => 'DT1072_18:UC_L2I5S0', 'UF_CRM_14_1778663165471' => '2026-10-01',
    ];
    $hold = Notifications::run($draftNow);
    deliveryAssert($hold['tasks'], 1, 'Hold remains in native task reads');
    deliveryAssert($hold['reports'], 1, 'Hold reports count toward both budgets');
    deliveryAssert(array_column($hold['digests'], 'actualTargetUserId'), [3, 40, 50], 'Hold uses ordinary actual live targets');
    deliveryAssert(array_column($hold['digests'], 'overrunCount'), [2, 1, 1], 'Hold delivers both budgets to the correct roles');
    deliveryAssert(array_column($hold['digests'], 'deadline'), [true, true, true], 'Hold includes the normal deadline');
    deliveryAssert(Notifications::run($draftNow)['sent'], 0, 'Hold deliveries also deduplicate');

    // Activation can complete while a scan is obtaining the configuration lock.
    $previewBeforeActivation = Option::$values['evolution.dev.tasks/notification_state_v1_preview_3'];
    unset(Option::$values['evolution.dev.tasks/notification_state_v1_live']);
    CIMNotify::$messages = [];
    Option::set('evolution.dev.tasks', 'delivery_mode', 'preview');
    \Bitrix\Main\Application::$onLock = static function (): void {
        Option::set('evolution.dev.tasks', 'delivery_mode', 'live');
    };
    $beforeActivationMessages = count(CIMNotify::$messages);
    $activated = Notifications::run($draftNow);
    deliveryAssert($activated['modeKey'], 'live', 'Mode is captured after the configuration lock');
    deliveryAssert($activated['mode'], 'live', 'Reported mode comes from the captured routing key');
    deliveryAssert(array_column($activated['digests'], 'actualTargetUserId'), [3, 40, 50], 'Completed activation uses real intended recipients');
    deliveryAssert(array_column(CIMNotify::$messages, 'TO_USER_ID'), [3, 40, 50], 'Completed activation delivers to actual intended recipients');
    deliveryAssert(Option::$values['evolution.dev.tasks/notification_state_v1_preview_3'], $previewBeforeActivation, 'Activation scan does not write the old preview ledger');
    deliveryAssert(isset(Option::$values['evolution.dev.tasks/notification_state_v1_live']), true, 'Activation scan uses live state');
    foreach (array_slice(CIMNotify::$messages, $beforeActivationMessages) as $message) {
        deliveryAssert(strpos($message['NOTIFY_TAG'], '|live|') !== false, true, 'Activation scan uses live tags');
        deliveryAssert(strpos($message['NOTIFY_MESSAGE'], 'Проверка уведомлений') === false, true, 'Activation scan uses live content');
    }
    deliveryAssert(Notifications::run($draftNow)['sent'], 0, 'Activated live scan is not duplicated');

    deliveryAssert(DeliveryMode::target(50, 'preview_3'), 3, 'Captured preview route stays preview after live activation');
    deliveryAssert(strpos(DeliveryMode::prefix(50, 'preview_3'), 'Проверка уведомлений') !== false, true, 'Captured preview keeps its label');
    Option::set('evolution.dev.tasks', 'delivery_mode', 'preview');
    deliveryAssert(DeliveryMode::target(50, 'live'), 50, 'Captured live route cannot fall back into preview');
    deliveryAssert(DeliveryMode::prefix(50, 'live'), '', 'Captured live has no preview prefix after a settings change');
    deliveryAssert(DeliveryMode::target(50, 'preview_40'), 40, 'Captured preview recipient is preserved independently of settings');
    deliveryAssert(DeliveryMode::target(50, 'invalid'), 3, 'Invalid captured key fails safely to default preview');

    // Native stage-history adapter: a self-setter developer handed off on the redline day.
    Option::set('evolution.dev.tasks', 'delivery_mode', 'preview');
    unset(Option::$values['evolution.dev.tasks/notification_state_v1_preview_3']);
    CIMNotify::$messages = [];
    FakeNotificationFactory::$reportHours = 0;
    FakeNotificationFactory::$taskOverrides = [
        'STAGE_ID' => 'DT1072_18:UC_5GG9S1', 'UF_CRM_14_1773214976' => [50, 40],
        'UF_CRM_14_1778663165471' => '2026-09-30',
    ];
    $entry = [
        'ID' => 900, 'OWNER_TYPE_ID' => 1072, 'OWNER_ID' => 100, 'TYPE_ID' => 2,
        'STAGE_ID' => 'DT1072_18:UC_5GG9S1', 'CATEGORY_ID' => 18,
        'CREATED_TIME' => new \DateTimeImmutable('2026-09-30 11:00', new \DateTimeZone('Europe/Moscow')),
    ];
    \Bitrix\Crm\History\Entity\EntityStageHistoryTable::$entries = [$entry];
    $checkNow = new \DateTimeImmutable('2026-10-02 10:00', new \DateTimeZone('Europe/Moscow'));
    $timely = Notifications::run($checkNow);
    deliveryAssert($timely['checkingHistoryKnown'], 1, 'Native current Check visit resolved');
    deliveryAssert(array_column($timely['digests'], 'intendedUserId'), [3, 40], 'Timely self-setter developer excluded from daily review reminders');
    deliveryAssert(array_unique(array_column(CIMNotify::$messages, 'TO_USER_ID')), [3], 'Check preview still sends only Artem');
    deliveryAssert(strpos($timely['digests'][0]['message'], 'Разработчик передал задачу в срок.') !== false, true, 'Timely handoff explained in review reminder');

    // A later Check cycle still prompts a comment even after today's review digest was delivered.
    \Bitrix\Crm\History\Entity\EntityStageHistoryTable::$entries[] = array_replace($entry, [
        'ID' => 901, 'CREATED_TIME' => new \DateTimeImmutable('2026-09-30 21:30:00+00:00'),
    ]);
    $late = Notifications::run($checkNow);
    deliveryAssert(array_column($late['digests'], 'intendedUserId'), [3, 50], 'Late new handoff reaches only developer and head');
    deliveryAssert(array_column($late['digests'], 'lateHandoffCount'), [1, 1], 'Comment requests tracked apart from daily deadline digest');
    deliveryAssert(strpos($late['digests'][1]['message'], 'напишите в комментарии') !== false, true, 'Developer receives a comment request');
    deliveryAssert(Notifications::run($checkNow)['sent'], 0, 'Same Check handoff does not repeat');
    deliveryAssert(array_unique(array_column(CIMNotify::$messages, 'TO_USER_ID')), [3], 'No actual developer delivery after late handoff');

    // A newer non-entry history row must not resurrect the older Check visit.
    \Bitrix\Crm\History\Entity\EntityStageHistoryTable::$entries[] = array_replace($entry, ['ID' => 902, 'TYPE_ID' => 3]);
    $unknown = Notifications::run($checkNow, true);
    deliveryAssert($unknown['checkingHistoryUnknown'], 1, 'Newer finalization makes stale Check visit unknown');
    deliveryAssert($unknown['digests'], [], 'Unknown history does not invent a developer accusation');
    echo "Notification adapter live/preview targets, ignored drafts, Hold, history and delivery idempotence passed.\n";
}
