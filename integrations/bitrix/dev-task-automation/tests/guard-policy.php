<?php

require_once __DIR__ . '/../src/GuardPolicy.php';

use Evolution\DevTaskAutomation\GuardPolicy;

$checks = 0;
function expectSame($expected, $actual, string $message): void
{
    global $checks;
    ++$checks;
    if ($expected !== $actual) {
        throw new RuntimeException($message . '\nExpected ' . var_export($expected, true) . '\nActual ' . var_export($actual, true));
    }
}

$metadata = [18 => [
    ['id' => 'DT1072_18:NEW', 'name' => 'Бэклог', 'sort' => 20, 'semantic' => 'P'],
    ['id' => 'DT1072_18:CLIENT', 'name' => 'В работе', 'sort' => 40, 'semantic' => 'P'],
    ['id' => 'DT1072_18:PREPARATION', 'name' => 'Спринт', 'sort' => 30, 'semantic' => 'P'],
    ['id' => 'DT1072_18:WAIT', 'name' => 'Требуется информация', 'sort' => 10, 'semantic' => 'P'],
    ['id' => 'DT1072_18:DONE', 'name' => 'Выполнено', 'sort' => 50, 'semantic' => 'S'],
]];
$stages = GuardPolicy::stages($metadata);
expectSame([18 => 'DT1072_18:CLIENT'], $stages['inWork'], 'Verified In work metadata is used.');
expectSame('DT1072_18:WAIT', $stages['initial'][18], 'Creation fallback uses actual first stage, not backlog guessed by suffix.');

$more = $metadata + [22 => [
    ['id' => 'DT1072_22:NEW', 'name' => 'New', 'sort' => 10, 'semantic' => 'P'],
    ['id' => 'DT1072_22:CUSTOM', 'name' => ' In work ', 'sort' => 20, 'semantic' => 'P'],
    ['id' => 'DT1072_22:CLIENT', 'name' => 'Waiting for client', 'sort' => 30, 'semantic' => 'P'],
]];
$allStages = GuardPolicy::stages($more);
expectSame('DT1072_22:CUSTOM', $allStages['inWork'][22], 'Other categories use a verified stage name, not CLIENT suffix.');
$withoutInWork = GuardPolicy::stages([33 => [['id' => 'DT1072_33:CLIENT', 'name' => 'Blocked', 'sort' => 10, 'semantic' => 'P']]]);
expectSame([], $withoutInWork['inWork'], 'Blocked does not consume an In work slot.');
try {
    GuardPolicy::stages([22 => [
        ['id' => 'A', 'name' => 'В работе', 'sort' => 1],
        ['id' => 'B', 'name' => 'In work', 'sort' => 2],
    ]]);
    throw new RuntimeException('Ambiguous metadata should fail.');
} catch (RuntimeException $exception) {
    expectSame('В воронке несколько стадий «В работе»: нужна явная настройка.', $exception->getMessage(), 'Ambiguous categories fail closed.');
}

$item = ['id' => 11, 'stage' => 'DT1072_18:CLIENT', 'category' => 18, 'assignee' => 7, 'movedAt' => 200];
$old = ['id' => 100, 'type' => 2, 'stage' => 'DT1072_18:PREPARATION', 'category' => 18, 'time' => 100];
$current = ['id' => 102, 'type' => 2, 'stage' => 'DT1072_18:CLIENT', 'category' => 18, 'time' => 200];
$history = [$old, $current];
expectSame($current, GuardPolicy::transition($item, $history), 'The current visit is selected even if history input is unordered.');
expectSame(['stage' => 'DT1072_18:PREPARATION', 'category' => 18], GuardPolicy::returnTarget($item, $history, 'DT1072_18:NEW', $stages), 'History overrides a stale PREVIOUS_STAGE_ID.');
expectSame(['stage' => 'DT1072_18:NEW', 'category' => 18], GuardPolicy::returnTarget($item, [$current], 'DT1072_18:NEW', $stages), 'Persisted previous stage supports incomplete historical data.');
expectSame(null, GuardPolicy::returnTarget($item, [$current], '', $stages), 'No invented fallback for a move with missing previous stage.');
$creation = $current;
$creation['type'] = 1;
expectSame(['stage' => 'DT1072_18:WAIT', 'category' => 18], GuardPolicy::returnTarget($item, [$creation], '', $stages), 'Direct creation in work returns to actual initial stage.');
$removed = $old;
$removed['stage'] = 'DELETED_STAGE';
expectSame(null, GuardPolicy::returnTarget($item, [$current, $removed], 'DT1072_18:NEW', $stages), 'A deleted exact prior stage must not silently change to another stage.');
$crossCategory = ['id' => 100, 'type' => 5, 'stage' => 'DT1072_22:NEW', 'category' => 22, 'time' => 100];
expectSame(['stage' => 'DT1072_22:NEW', 'category' => 22], GuardPolicy::returnTarget($item, [$current, $crossCategory], '', $allStages), 'Exact rollback retains the original category.');
$alreadyInWork = $old;
$alreadyInWork['stage'] = 'DT1072_22:CUSTOM';
$alreadyInWork['category'] = 22;
expectSame(null, GuardPolicy::returnTarget($item, [$current, $alreadyInWork], '', $allStages), 'Returning into another In work stage does not solve the conflict.');

$fingerprint = GuardPolicy::fingerprint($item, $current);
expectSame(true, GuardPolicy::sameTransition($fingerprint, $item, $current), 'Unchanged transition can be returned.');
$reassigned = $item;
$reassigned['assignee'] = 8;
expectSame(false, GuardPolicy::sameTransition($fingerprint, $reassigned, $current), 'A late check cannot revert after reassignment.');
$secondVisit = $current;
$secondVisit['id'] = 105;
expectSame(false, GuardPolicy::sameTransition($fingerprint, $item, $secondVisit), 'A rapid second visit to the same stage invalidates the old check even at same timestamp.');
$pendingRead = $fingerprint;
$pendingRead['historyId'] = 0;
expectSame(false, GuardPolicy::samePendingTransition($pendingRead, $item, $current), 'Unverified history can never bind to a later visit, even at the same timestamp.');
expectSame(true, GuardPolicy::samePendingTransition($fingerprint, $item, $current), 'A verified pending transition can be retried unchanged.');
expectSame(false, GuardPolicy::samePendingTransition($pendingRead, $reassigned, $current), 'Pending checks cannot bind after reassignment.');
expectSame(false, GuardPolicy::samePendingTransition($fingerprint, $item, $secondVisit), 'A known pending visit cannot bind to a new visit.');
$laterMove = $item;
$laterMove['movedAt'] = 300;
expectSame(false, GuardPolicy::samePendingTransition($pendingRead, $laterMove, $secondVisit), 'Pending checks cannot follow another moved time.');
expectSame(false, GuardPolicy::attemptKey($fingerprint) === GuardPolicy::attemptKey(GuardPolicy::fingerprint($item, $secondVisit)), 'Queue identities distinguish visits even when timestamps tie.');
$left = $item;
$left['stage'] = 'DT1072_18:DONE';
expectSame(null, GuardPolicy::transition($left, $history), 'History for an older In work visit cannot be used once current stage changed.');

$a = ['id' => 11, 'entryId' => 102, 'entryTime' => 200];
$b = ['id' => 12, 'entryId' => 103, 'entryTime' => 200];
expectSame(11, GuardPolicy::winner([$a, $b]), 'Concurrent tasks choose the first history entry.');
expectSame(11, GuardPolicy::winner([$b, $a]), 'Both robot executions choose the same winner, avoiding two rollbacks.');
expectSame(11, GuardPolicy::winner([$a]), 'A task never conflicts with itself.');
expectSame(null, GuardPolicy::winner([]), 'A departed task does not create a winner.');
expectSame(9, GuardPolicy::winner([$a, ['id' => 9, 'entryId' => 0, 'entryTime' => 0]]), 'Missing history protects an incumbent instead of silently ignoring it.');
expectSame(13, GuardPolicy::winner([$a, ['id' => 13, 'entryId' => 99, 'entryTime' => 100]]), 'An earlier visit beats a newly entered task.');

$provider = 'Bitrix\\Crm\\Integration\\BizProc\\Document\\Dynamic';
expectSame(11, GuardPolicy::itemIdFromDocument(['crm', $provider, 'DYNAMIC_1072_11']), 'Only the intended Dynamic document is accepted.');
expectSame(null, GuardPolicy::itemIdFromDocument(['crm', $provider, 'DYNAMIC_1074_11']), 'Other smart processes cannot invoke a rollback.');
expectSame(null, GuardPolicy::itemIdFromDocument(['crm', 'CCrmDocumentDeal', 'DEAL_11']), 'Deals cannot invoke a rollback.');
expectSame(null, GuardPolicy::itemIdFromDocument(['crm', $provider, 'DYNAMIC_1072_0']), 'Invalid item ID is rejected.');
expectSame(0, GuardPolicy::timestamp('not a date'), 'Invalid timestamp cannot invent entry order.');

echo "Guard policy: {$checks} checks passed\n";
