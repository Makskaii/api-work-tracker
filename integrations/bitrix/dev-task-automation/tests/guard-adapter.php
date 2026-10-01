<?php

/** No portal bootstrap: adapter tests use only isolated in-memory Bitrix doubles. */
namespace Bitrix\Main {
    class Error { public function __construct(public string $message, public string $code = '') {} public function getCode() { return $this->code; } }
    class Result {
        private array $errors = [];
        public function addError(Error $error) { $this->errors[] = $error; return $this; }
        public function getErrors() { return $this->errors; }
        public function isSuccess() { return !$this->errors; }
    }
    class Loader { public static function includeModule($name) { return true; } }
    class TestConnection {
        public bool $denyResponsibleLock = false;
        public array $locks = [];
        public function lock($name, $timeout = 0) { $this->locks[] = ['lock', $name]; return !($this->denyResponsibleLock && preg_match('/^evolution_dev_wip_1072_/', $name)); }
        public function unlock($name) { $this->locks[] = ['unlock', $name]; return true; }
    }
    class Application { public static TestConnection $connection; public static function getConnection() { return self::$connection; } }
}
namespace Bitrix\Main\Config {
    class Option {
        public static array $values = [];
        public static function get($module, $key, $default = '') { return self::$values[$module . ':' . $key] ?? $default; }
        public static function set($module, $key, $value) { self::$values[$module . ':' . $key] = $value; }
    }
}
namespace Bitrix\Crm {
    class Item {
        public function __construct(public int $id, public string $stage, public int $assignee, public int $movedAt, public int $category = 18, public string $description = 'unchanged') {}
        public function getId() { return $this->id; }
        public function getTitle() { return 'Task ' . $this->id; }
        public function getStageId() { return $this->stage; }
        public function getCategoryId() { return $this->category; }
        public function getAssignedById() { return $this->assignee; }
        public function getMovedTime() { return $this->movedAt; }
        public function setStageId($value) { $this->stage = $value; }
        public function setCategoryId($value) { $this->category = $value; }
    }
}
namespace Bitrix\Crm\Service {
    use Bitrix\Crm\Item;
    use Bitrix\Main\Result;
    use Bitrix\Main\Error;
    class Container { public static Factory $factory; public static function getInstance() { return new self(); } public function getFactory($id) { return $id === 1072 ? self::$factory : null; } }
    class TestCategory { public function getId() { return 18; } }
    class TestStage {
        public function __construct(private string $id, private string $name, private int $sort, private string $semantics = 'P') {}
        public function getStatusId() { return $this->id; }
        public function getName() { return $this->name; }
        public function getSort() { return $this->sort; }
        public function getSemantics() { return $this->semantics; }
    }
    class Factory {
        public array $items = [], $histories = [], $operations = [], $filters = [];
        public bool $operationFails = false, $listThrows = false;
        public $beforeSave = null;
        public function getItem($id) { return isset($this->items[$id]) ? clone $this->items[$id] : null; }
        public function getItems($query) {
            if ($this->listThrows) { throw new \RuntimeException('private database detail that must not leak'); }
            $this->filters[] = $query['filter'];
            return array_values(array_map(static fn($item) => clone $item, array_filter($this->items, static fn($item) => $item->assignee === $query['filter']['=ASSIGNED_BY_ID'] && in_array($item->stage, $query['filter']['@STAGE_ID'], true))));
        }
        public function getCategories() { return [new TestCategory()]; }
        public function getStages($category) { return [new TestStage('DT1072_18:WAIT', 'Требуется информация', 10), new TestStage('DT1072_18:NEW', 'Бэклог', 20), new TestStage('DT1072_18:PREPARATION', 'Спринт', 30), new TestStage('DT1072_18:CLIENT', 'В работе', 40), new TestStage('DT1072_18:DONE', 'Выполнено', 50, 'S')]; }
        public function getUpdateOperation(Item $item) { return new Operation($this, $item); }
    }
    class Operation {
        public const ACTION_BEFORE_SAVE = 'before';
        public array $flags = [], $actions = [];
        public function __construct(private Factory $factory, private Item $item) {}
        public function disableAutomation() { $this->flags['automation'] = false; return $this; }
        public function disableBizProc() { $this->flags['bizproc'] = false; return $this; }
        public function disableCheckRequiredUserFields() { $this->flags['requiredUf'] = false; return $this; }
        public function disableCheckAccess() { $this->flags['access'] = false; return $this; }
        public function addAction($when, $action) { $this->actions[] = $action; return $this; }
        public function launch() {
            if ($this->factory->beforeSave) { ($this->factory->beforeSave)($this->factory); }
            foreach ($this->actions as $action) { $result = $action->process($this->item); if (!$result->isSuccess()) { return $result; } }
            $result = new Result();
            if ($this->factory->operationFails) { return $result->addError(new Error('Failed', 'TEST_ERROR')); }
            $this->factory->items[$this->item->id] = clone $this->item;
            $this->factory->operations[] = ['id' => $this->item->id, 'flags' => $this->flags];
            $this->factory->histories[$this->item->id][] = ['ID' => 900 + count($this->factory->operations), 'TYPE_ID' => 2, 'STAGE_ID' => $this->item->stage, 'CATEGORY_ID' => $this->item->category, 'CREATED_TIME' => 500];
            return $result;
        }
    }
}
namespace Bitrix\Crm\Service\Operation { abstract class Action { abstract public function process(\Bitrix\Crm\Item $item): \Bitrix\Main\Result; } }
namespace Bitrix\Crm\History\Entity {
    class EntityStageHistoryTable {
        public static function getList($query) {
            if ($query['filter']['=OWNER_TYPE_ID'] !== 1072) { throw new \RuntimeException('Wrong owner type'); }
            $rows = \Bitrix\Crm\Service\Container::$factory->histories[$query['filter']['=OWNER_ID']] ?? [];
            return new class($rows) { public function __construct(private array $rows) {} public function fetchAll() { return $this->rows; } };
        }
    }
}
namespace Bitrix\Im\Model {
    class MessageTable {
        public static function getList($query) { $tag = $query['filter']['=NOTIFY_TAG']; return new class($tag) { public function __construct(private string $tag) {} public function fetch() { foreach (\CIMNotify::$messages as $i => $message) { if ($message['NOTIFY_TAG'] === $this->tag) { return ['ID' => $i + 1]; } } return false; } }; }
    }
}
namespace {
    use Bitrix\Crm\Item;
    use Bitrix\Crm\Service\Container;
    use Bitrix\Crm\Service\Factory;
    use Bitrix\Main\Application;
    use Bitrix\Main\Config\Option;
    use Evolution\DevTaskAutomation\GuardPolicy;
    use Evolution\DevTaskAutomation\GuardRetry;
    use Evolution\DevTaskAutomation\WorkInProgressGuard;
    define('IM_NOTIFY_SYSTEM', 4);
    class CIMNotify { public static array $messages = []; public static function Add($message) { self::$messages[] = $message; return count(self::$messages); } }
    class CEventLog { public static array $messages = []; public static function Add($message) { self::$messages[] = $message; } }
    class CBPDocument {
        public static int $starts = 0, $originalActions = 0;
        public static bool $ambiguousStart = false;
        public static $beforeStart = null;
        public static function StartWorkflow($templateId, $documentId, $parameters, &$errors) {
            if ($templateId !== 217) { throw new RuntimeException('Wrong template'); }
            ++self::$starts;
            if (self::$beforeStart) { (self::$beforeStart)(Container::$factory); }
            if (self::$ambiguousStart) { throw new RuntimeException('Unknown start outcome'); }
            $id = GuardPolicy::itemIdFromDocument($documentId);
            $outcome = (new WorkInProgressGuard())->check($id);
            if ($outcome['allowed']) { ++self::$originalActions; }
            return 'test-workflow-' . self::$starts;
        }
    }
    require_once __DIR__ . '/../src/GuardPolicy.php';
    require_once __DIR__ . '/../src/DeliveryMode.php';
    require_once __DIR__ . '/../src/GuardRetry.php';
    require_once __DIR__ . '/../src/WorkInProgressGuard.php';
    $checks = 0;
    function check($expected, $actual, string $message): void { global $checks; ++$checks; if ($expected !== $actual) { throw new RuntimeException($message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true)); } }
    function resetCase(): Factory { $factory = new Factory(); Container::$factory = $factory; Application::$connection = new \Bitrix\Main\TestConnection(); Option::$values = []; CIMNotify::$messages = []; CEventLog::$messages = []; CBPDocument::$starts = CBPDocument::$originalActions = 0; CBPDocument::$ambiguousStart = false; CBPDocument::$beforeStart = null; return $factory; }
    function addTask(Factory $factory, int $id, int $entryId, int $time, string $prior = 'DT1072_18:PREPARATION', bool $creation = false): void {
        $factory->items[$id] = new Item($id, 'DT1072_18:CLIENT', 7, $time);
        $factory->histories[$id] = [['ID' => $entryId, 'TYPE_ID' => $creation ? 1 : 2, 'STAGE_ID' => 'DT1072_18:CLIENT', 'CATEGORY_ID' => 18, 'CREATED_TIME' => $time]];
        if (!$creation) { $factory->histories[$id][] = ['ID' => $entryId - 1, 'TYPE_ID' => 2, 'STAGE_ID' => $prior, 'CATEGORY_ID' => 18, 'CREATED_TIME' => $time - 1]; }
    }
    function queue(): array { $raw = Option::get(GuardRetry::MODULE, GuardRetry::OPTION, ''); return $raw === '' ? [] : json_decode($raw, true)['queue']; }
    function makeDue(): void { $state = json_decode(Option::get(GuardRetry::MODULE, GuardRetry::OPTION), true); foreach ($state['queue'] as &$entry) { $entry['nextAt'] = 0; } unset($entry); Option::set(GuardRetry::MODULE, GuardRetry::OPTION, json_encode($state)); }

    $guard = new WorkInProgressGuard();
    $factory = resetCase(); addTask($factory, 11, 100, 100);
    check(true, $guard->check(11)['allowed'], 'Only current task is allowed.');
    check([], $factory->operations, 'Allowed check does not write the item.');
    check([], CIMNotify::$messages, 'Allowed check does not notify.');

    $factory = resetCase(); addTask($factory, 10, 90, 90); addTask($factory, 11, 100, 100);
    $outcome = $guard->check(11, 'DT1072_18:NEW');
    check(true, $outcome['reverted'], 'New second task is returned.');
    check('DT1072_18:PREPARATION', $factory->items[11]->stage, 'Exact history stage beats stale previous-stage field.');
    check('DT1072_18:CLIENT', $factory->items[10]->stage, 'Incumbent is unchanged.');
    check('unchanged', $factory->items[11]->description, 'Other fields survive rollback.');
    check(['automation' => false, 'bizproc' => false, 'requiredUf' => false, 'access' => false], $factory->operations[0]['flags'], 'Only intended rollback checks and automation are disabled.');
    check(['=ASSIGNED_BY_ID', '@STAGE_ID'], array_keys($factory->filters[0]), 'Responsible slot spans projects and all verified categories.');
    check(3, CIMNotify::$messages[0]['TO_USER_ID'], 'Trial rollback notices go only to Artem.');
    check(true, str_contains(CIMNotify::$messages[0]['NOTIFY_MESSAGE'], 'Сотрудник №7'), 'Trial notice names its intended responsible.');

    $factory = resetCase(); addTask($factory, 10, 90, 90); addTask($factory, 11, 100, 100, '', true);
    check(true, $guard->check(11)['reverted'], 'Direct creation in work is guarded.');
    check('DT1072_18:WAIT', $factory->items[11]->stage, 'Direct creation uses actual category initial stage.');

    $factory = resetCase(); addTask($factory, 10, 80, 80); addTask($factory, 12, 90, 90); addTask($factory, 11, 100, 100);
    $guard->check(11);
    check('DT1072_18:CLIENT', $factory->items[10]->stage, 'First preexisting duplicate is not repaired in bulk.');
    check('DT1072_18:CLIENT', $factory->items[12]->stage, 'Second preexisting duplicate is not repaired in bulk.');
    check(1, count($factory->operations), 'Only attempted task is changed.');

    $factory = resetCase(); addTask($factory, 11, 100, 100); addTask($factory, 12, 101, 100);
    check(true, $guard->check(12)['reverted'], 'Later concurrent visit loses even if its guard executes first.');
    check(true, $guard->check(11)['allowed'], 'Earliest concurrent visit remains allowed.');

    $factory = resetCase(); addTask($factory, 10, 90, 90); addTask($factory, 11, 100, 100); Application::$connection->denyResponsibleLock = true;
    $outcome = $guard->check(11);
    check(true, $outcome['retryNeeded'], 'Lock timeout queues the verified attempt.');
    check(100, queue()[11]['fingerprint']['historyId'], 'Retry is bound to exact current history row.');
    check('DT1072_18:CLIENT', $factory->items[11]->stage, 'Lock failure performs no write.');
    Application::$connection->denyResponsibleLock = false; makeDue();
    check(1, GuardRetry::run()['reverted'], 'Retry returns rejected task after lock becomes available.');
    check([], queue(), 'Successful rollback clears its retry.');
    check(2, count(CIMNotify::$messages), 'Pending and final rollback notices are distinct.');

    $factory = resetCase(); addTask($factory, 11, 100, 100); Application::$connection->denyResponsibleLock = true; $guard->check(11); Application::$connection->denyResponsibleLock = false; $savedHistory = $factory->histories[11]; $factory->histories[11] = []; makeDue();
    check(1, GuardRetry::run()['pending'], 'A temporarily unreadable verified history remains pending.');
    check(100, queue()[11]['fingerprint']['historyId'], 'Temporary read failure never rebinds the original history ID.');
    $factory->histories[11] = $savedHistory; makeDue();
    check(1, GuardRetry::run()['continued'], 'Verified visibility retry eventually resumes original actions.');

    $factory = resetCase(); addTask($factory, 11, 100, 100); Application::$connection->denyResponsibleLock = true; $guard->check(11);
    Application::$connection->denyResponsibleLock = false; $factory->items[11]->assignee = 8; makeDue();
    check(1, GuardRetry::run()['stale'], 'Reassigned task invalidates queued visit.');
    check([], $factory->operations, 'Stale retry does not change reassigned task.');
    check([], queue(), 'Stale attempt is removed.');

    $factory = resetCase(); addTask($factory, 10, 90, 90); addTask($factory, 11, 100, 100);
    $factory->beforeSave = static function ($factory) { $factory->items[11]->assignee = 8; };
    check(true, $guard->check(11)['stale'], 'Before-save validation detects reassignment during operation.');
    check([], $factory->operations, 'No stale rollback is persisted.');

    $factory = resetCase(); addTask($factory, 10, 90, 90); addTask($factory, 11, 100, 100); $factory->operationFails = true;
    check(true, $guard->check(11)['retryNeeded'], 'Transient update failure stays pending.');
    $factory->operationFails = false; makeDue();
    check(1, GuardRetry::run()['reverted'], 'Failed rollback can succeed on exact-visit retry.');

    $factory = resetCase(); addTask($factory, 11, 100, 100); $factory->listThrows = true;
    check(true, $guard->check(11)['retryNeeded'], 'Infrastructure read failure queues a verified transition.');
    check(false, str_contains(json_encode(CIMNotify::$messages), 'private database'), 'Notifications never expose exception details.');
    check(false, str_contains(json_encode(CEventLog::$messages), 'private database'), 'Logs never expose exception details.');

    $factory = resetCase(); addTask($factory, 11, 100, 100); $factory->histories[11] = [];
    check(false, $guard->check(11)['retryNeeded'], 'Unavailable current history is never queued unsafely.');
    check([], queue(), 'No history-id-zero pending entry exists.');
    check([], $factory->operations, 'Unavailable history cannot roll back any visit.');

    $factory = resetCase(); addTask($factory, 11, 100, 100); Application::$connection->denyResponsibleLock = true; $guard->check(11); Application::$connection->denyResponsibleLock = false; makeDue();
    check(1, GuardRetry::run()['continued'], 'Allowed retry resumes original stage actions.');
    check(1, CBPDocument::$starts, 'Continuation starts existing template 217 once.');
    check(1, CBPDocument::$originalActions, 'Original actions execute on verified allowed retry.');
    check([], queue(), 'Successful continuation clears exact pending entry.');
    GuardRetry::run(); check(1, CBPDocument::$starts, 'Completed continuation cannot restart original actions.');

    $factory = resetCase(); addTask($factory, 11, 100, 100); Application::$connection->denyResponsibleLock = true; $guard->check(11); Application::$connection->denyResponsibleLock = false; makeDue();
    CBPDocument::$beforeStart = static function ($factory) { $factory->histories[11][] = ['ID' => 103, 'TYPE_ID' => 2, 'STAGE_ID' => 'DT1072_18:CLIENT', 'CATEGORY_ID' => 18, 'CREATED_TIME' => 100]; };
    GuardRetry::run();
    check(0, CBPDocument::$originalActions, 'Same-second second visit cannot inherit pending original actions.');
    check([], $factory->operations, 'Same-second second visit is not rolled back by continuation.');
    check([], queue(), 'Stale continuation clears only its attempt.');

    $factory = resetCase(); addTask($factory, 11, 100, 100); Application::$connection->denyResponsibleLock = true; $guard->check(11); Application::$connection->denyResponsibleLock = false; makeDue(); CBPDocument::$ambiguousStart = true;
    GuardRetry::run(); makeDue(); GuardRetry::run();
    check(1, CBPDocument::$starts, 'Ambiguous workflow start is not retried and cannot duplicate actions.');
    check('starting', queue()[11]['continuation'], 'Ambiguous continuation retains an administrative claim.');
    check(2, count(CIMNotify::$messages), 'Administrative continuation problem has a distinct visible notice.');
    check(false, $guard->check(11)['allowed'], 'Normal workflow cannot execute original actions during an existing continuation claim.');
    check('starting', queue()[11]['continuation'], 'Normal workflow cannot clear an active continuation claim.');

    $factory = resetCase(); Application::$connection->denyResponsibleLock = true;
    for ($i = 1; $i <= 11; ++$i) { addTask($factory, $i, 100 + $i, 100 + $i); $factory->items[$i]->assignee = 200 + $i; $guard->check($i); }
    addTask($factory, 20, 200, 200); $guard->check(20);
    $state = json_decode(Option::get(GuardRetry::MODULE, GuardRetry::OPTION), true);
    for ($i = 1; $i <= 11; ++$i) { $state['queue'][$i]['continuation'] = 'starting'; }
    Option::set(GuardRetry::MODULE, GuardRetry::OPTION, json_encode($state)); Application::$connection->denyResponsibleLock = false; makeDue();
    $outcome = GuardRetry::run();
    check(1, $outcome['continued'], 'Eleven administrative claims do not starve a legitimate retry.');
    check(10, $outcome['manualChecked'], 'Administrative cleanup has a separate bounded budget.');
    check(1, CBPDocument::$starts, 'Only the unclaimed transition starts the workflow.');

    $factory = resetCase(); addTask($factory, 10, 90, 90); addTask($factory, 11, 100, 100);
    Option::set(GuardRetry::MODULE, 'delivery_mode', 'live'); $guard->check(11);
    check(7, CIMNotify::$messages[0]['TO_USER_ID'], 'Only explicit live mode delivers notices to the responsible.');
    check(false, str_contains(CIMNotify::$messages[0]['NOTIFY_MESSAGE'], 'Проверка уведомлений'), 'Live notice has no trial prefix.');

    echo "Guard adapter: {$checks} checks passed\n";
}
