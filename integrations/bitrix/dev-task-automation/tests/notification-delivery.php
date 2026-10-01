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
        public static function getConnection(): object {
            return new class {
                public function lock(string $name, int $timeout): bool { return true; }
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
namespace {
    use Bitrix\Main\Config\Option;
    use Evolution\DevTaskAutomation\DeliveryMode;
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
        private int $type;
        public function __construct(int $type) { $this->type = $type; }
        public function getItems(array $parameters): array {
            $data = $this->type === 1072 ? [
                'ID' => 100, 'TITLE' => 'Проверка доставки', 'STAGE_ID' => 'DT1072_18:CLIENT',
                'ASSIGNED_BY_ID' => 50, 'UF_CRM_14_1773214976' => [40],
                'UF_CRM_14_1778663165471' => '2026-10-02',
                'UF_CRM_14_1770731674952' => '10', 'UF_CRM_14_1776177413413' => 20,
            ] : ['ID' => 200, 'PARENT_ID_1072' => 100, 'UF_CRM_11_1770627880479' => 25];
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
    echo "Notification adapter preview-only targets, labels, idempotence and separate future-live state passed.\n";
}
