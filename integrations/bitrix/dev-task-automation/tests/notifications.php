<?php

use Evolution\DevTaskAutomation\NotificationPolicy as Policy;
use Evolution\DevTaskAutomation\Notifications;

if (!class_exists(Policy::class)) {
    require __DIR__ . '/../src/NotificationPolicy.php';
}
if (!class_exists(Notifications::class)) {
    require __DIR__ . '/../src/Notifications.php';
}

function notificationAssert($actual, $expected, string $message): void
{
    if ($actual !== $expected) {
        throw new RuntimeException($message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true));
    }
}
function notificationTask(array $overrides = []): array
{
    return array_replace([
        'id' => 1062, 'title' => 'Разработка интеграции', 'stage' => 'DT1072_18:CLIENT', 'category' => 18,
        'assignee' => 50, 'setters' => [3, 40], 'redline' => '2026-10-01',
        'estimate' => '10', 'sold' => 20, 'actual' => 0,
    ], $overrides);
}
function notificationNow(string $time): DateTimeImmutable
{
    return new DateTimeImmutable($time, new DateTimeZone('Europe/Moscow'));
}
function notificationDeliverAll(array $evaluation): array
{
    $state = $evaluation['state'];
    foreach ($evaluation['digests'] as $digest) {
        $state = Policy::delivered($state, $digest);
    }
    return $state;
}
function notificationUserDigest(array $digests, int $userId): array
{
    foreach ($digests as $digest) {
        if ($digest['userId'] === $userId) {
            return $digest;
        }
    }
    return [];
}

$cases = [];
$cases['decimal hours and unset limits'] = static function (): void {
    notificationAssert(Policy::hours(' 1 234,50 '), 1234.5, 'Comma and spaces parse');
    notificationAssert(Policy::hours('1 234,5'), 1234.5, 'Nonbreaking spaces parse');
    foreach (['', null, '8/12', '2 ч', '-1', true, 'NAN', INF] as $value) {
        notificationAssert(Policy::hours($value), null, 'Ambiguous or invalid estimate is not invented');
    }
};
$cases['Moscow weekday deadline window'] = static function (): void {
    notificationAssert(Policy::deadlineWindow(notificationNow('2026-10-01 09:59:59')), false, 'Wait until 10 Moscow');
    notificationAssert(Policy::deadlineWindow(new DateTimeImmutable('2026-10-01 07:00:00+00:00')), true, 'UTC converted to Moscow');
    notificationAssert(Policy::deadlineWindow(notificationNow('2026-10-03 11:00')), false, 'Saturday silent');
    notificationAssert(Policy::deadlineWindow(notificationNow('2026-10-04 11:00')), false, 'Sunday silent');
};
$cases['validated redline dates including Bitrix-like objects'] = static function (): void {
    notificationAssert(Policy::date('01.10.2026'), '2026-10-01', 'Russian date');
    notificationAssert(Policy::date('2026-02-30'), null, 'Invalid calendar day rejected');
    $date = new class {
        public function format(string $format): string { return '2026-10-01'; }
    };
    notificationAssert(Policy::date($date), '2026-10-01', 'Bitrix date object accepted');
};
$cases['three roles deduplicate multiple setters'] = static function (): void {
    $evaluation = Policy::evaluate([notificationTask(['setters' => [3, '40', 'user_40', 0]])], 3, [], notificationNow('2026-10-01 10:00'));
    notificationAssert(array_column($evaluation['digests'], 'userId'), [3, 40, 50], 'Head/setter overlap has no duplicate');
    notificationAssert(count(notificationUserDigest($evaluation['digests'], 3)['tasks']), 1, 'One task row');
};
$cases['daily overdue including historical dates and weekend rollover'] = static function (): void {
    $task = notificationTask(['redline' => '2026-09-01']);
    $evaluation = Policy::evaluate([$task], 3, [], notificationNow('2026-10-02 10:00'));
    notificationAssert(notificationUserDigest($evaluation['digests'], 50)['tasks'][0]['reasons']['deadline']['days'], 31, 'Historical overdue included');
    $state = notificationDeliverAll($evaluation);
    notificationAssert(Policy::evaluate([$task], 3, $state, notificationNow('2026-10-02 14:00'))['digests'], [], 'Once per weekday');
    notificationAssert(Policy::evaluate([$task], 3, $state, notificationNow('2026-10-03 10:00'))['digests'], [], 'No Saturday repeat');
    notificationAssert(count(Policy::evaluate([$task], 3, $state, notificationNow('2026-10-05 10:00'))['digests']), 3, 'Monday overdue resumes');
};
$cases['overrun instant even before 10 and on weekends'] = static function (): void {
    $evaluation = Policy::evaluate([notificationTask(['actual' => 10.5])], 3, [], notificationNow('2026-10-03 08:00'));
    notificationAssert(array_column($evaluation['digests'], 'userId'), [3, 50], 'Estimate responsible + head only');
    notificationAssert($evaluation['digests'][0]['deadlineDay'], null, 'No weekend deadline mixed in');
    notificationAssert(notificationUserDigest($evaluation['digests'], 50)['tasks'][0]['reasons']['estimate']['overrun'], 0.5, 'Correct excess');
};
$cases['client limit routes to all setters and head'] = static function (): void {
    $evaluation = Policy::evaluate([notificationTask(['estimate' => 100, 'sold' => '20,0', 'actual' => 21])], 3, [], notificationNow('2026-10-01 09:00'));
    notificationAssert(array_column($evaluation['digests'], 'userId'), [3, 40], 'Client limit setter/head');
};
$cases['same task both thresholds one digest and one task row'] = static function (): void {
    $evaluation = Policy::evaluate([notificationTask(['actual' => 25])], 3, [], notificationNow('2026-10-01 10:00'));
    $head = notificationUserDigest($evaluation['digests'], 3);
    notificationAssert(count($head['tasks']), 1, 'No duplicate task for role or threshold');
    notificationAssert(array_keys($head['tasks'][0]['reasons']), ['deadline', 'estimate', 'sold'], 'Reasons merged');
    notificationAssert(count($head['overrunMarks']), 2, 'Both deliveries committed');
};
$cases['historical tasks merge into one complete digest per recipient'] = static function (): void {
    $tasks = [];
    for ($id = 1; $id <= 83; $id++) {
        $tasks[] = notificationTask(['id' => $id, 'redline' => '2026-09-01']);
    }
    $evaluation = Policy::evaluate($tasks, 3, [], notificationNow('2026-10-01 10:00'));
    notificationAssert(count($evaluation['digests']), 3, '83 old tasks produce 3 digests, not 249 messages');
    notificationAssert(count(notificationUserDigest($evaluation['digests'], 3)['tasks']), 83, 'No overdue tasks silently omitted');
};
$cases['new department head gets current threshold once'] = static function (): void {
    $task = notificationTask(['actual' => 12, 'sold' => null]);
    $state = notificationDeliverAll(Policy::evaluate([$task], 3, [], notificationNow('2026-10-01 09:00')));
    $evaluation = Policy::evaluate([$task], 90, $state, notificationNow('2026-10-01 09:01'));
    notificationAssert(array_column($evaluation['digests'], 'userId'), [90], 'Dynamic new head receives existing edge once');
    $state = notificationDeliverAll($evaluation);
    notificationAssert(Policy::evaluate([$task], 90, $state, notificationNow('2026-10-01 09:02'))['digests'], [], 'New head does not receive minute repeats');
};
$cases['check responsibility belongs to multiple analysts and head'] = static function (): void {
    $evaluation = Policy::evaluate([notificationTask(['stage' => Policy::CHECK_STAGE, 'actual' => 25])], 3, [], notificationNow('2026-10-01 10:00'));
    notificationAssert(array_column($evaluation['digests'], 'userId'), [3, 40], 'Developer is excluded while checking');
    notificationAssert(array_keys(notificationUserDigest($evaluation['digests'], 40)['tasks'][0]['reasons']), ['deadline', 'estimate', 'sold'], 'Analyst sees both overruns in checking');
};
$cases['return from checking alerts newly eligible developer once'] = static function (): void {
    $checking = notificationTask(['stage' => Policy::CHECK_STAGE, 'actual' => 25]);
    $state = notificationDeliverAll(Policy::evaluate([$checking], 3, [], notificationNow('2026-10-01 09:00')));
    $back = Policy::evaluate([notificationTask(['actual' => 25])], 3, $state, notificationNow('2026-10-01 09:01'));
    notificationAssert(array_column($back['digests'], 'userId'), [50], 'Only new eligible developer receives estimate edge');
    $state = notificationDeliverAll($back);
    notificationAssert(Policy::evaluate([notificationTask(['actual' => 26])], 3, $state, notificationNow('2026-10-01 09:02'))['digests'], [], 'Increasing hours do not repeat crossing');
};
$cases['limit change and corrected report rearm threshold'] = static function (): void {
    $task = notificationTask(['actual' => 12, 'sold' => null]);
    $state = notificationDeliverAll(Policy::evaluate([$task], 3, [], notificationNow('2026-10-01 09:00')));
    $increase = Policy::evaluate([array_replace($task, ['estimate' => 11])], 3, $state, notificationNow('2026-10-01 09:01'));
    notificationAssert(count($increase['digests']), 2, 'Changed exceeded limit alerts once');
    $state = notificationDeliverAll($increase);
    $below = Policy::evaluate([array_replace($task, ['actual' => 9, 'estimate' => 11])], 3, $state, notificationNow('2026-10-01 09:02'));
    notificationAssert($below['digests'], [], 'Correction below limit rearmed quietly');
    $recross = Policy::evaluate([array_replace($task, ['actual' => 12, 'estimate' => 11])], 3, $below['state'], notificationNow('2026-10-01 09:03'));
    notificationAssert(count($recross['digests']), 2, 'After rearm a new crossing alerts');
};
$cases['partial delivery retries only failed recipient'] = static function (): void {
    $task = notificationTask(['actual' => 12, 'sold' => null]);
    $evaluation = Policy::evaluate([$task], 3, [], notificationNow('2026-10-01 10:00'));
    $state = Policy::delivered($evaluation['state'], notificationUserDigest($evaluation['digests'], 3));
    $state = Policy::delivered($state, notificationUserDigest($evaluation['digests'], 40));
    $retry = Policy::evaluate([$task], 3, $state, notificationNow('2026-10-01 10:01'));
    notificationAssert(array_column($retry['digests'], 'userId'), [50], 'Successful people not resent');
    notificationAssert($retry['digests'][0]['key'], notificationUserDigest($evaluation['digests'], 50)['key'], 'Stable retry key');
};
$cases['zero equality invalid and absent budgets do not alert'] = static function (): void {
    foreach ([['estimate' => 10, 'actual' => 10], ['estimate' => 0, 'actual' => 5], ['estimate' => '2 ч', 'actual' => 5], ['estimate' => null, 'actual' => 5]] as $values) {
        $evaluation = Policy::evaluate([notificationTask(array_replace(['sold' => null], $values))], 3, [], notificationNow('2026-10-01 09:00'));
        notificationAssert($evaluation['digests'], [], 'No fabricated limit or exact-limit warning');
    }
};
$cases['completed cancelled deleted tasks prune state'] = static function (): void {
    $state = notificationDeliverAll(Policy::evaluate([notificationTask(['actual' => 12])], 3, [], notificationNow('2026-10-01 09:00')));
    foreach (Policy::CLOSED_STAGES as $stage) {
        $closed = Policy::evaluate([notificationTask(['actual' => 25, 'stage' => $stage])], 3, $state, notificationNow('2026-10-01 10:00'));
        notificationAssert($closed['digests'], [], 'Closed stage excluded');
        notificationAssert($closed['state']['thresholds'], [], 'Closed task state removed');
    }
    notificationAssert(Policy::evaluate([], 3, $state, notificationNow('2026-10-01 09:01'))['state']['thresholds'], [], 'Deleted report/task does not remain forever');
};
$cases['unformed drafts ignore deadlines and both overruns and remove old alert state'] = static function (): void {
    $checking = notificationTask([
        'stage' => Policy::CHECK_STAGE, 'actual' => 25, 'redline' => '2026-09-30',
        'checkHandoff' => ['id' => 900, 'date' => '2026-10-01'],
    ]);
    $state = notificationDeliverAll(Policy::evaluate([$checking], 3, [], notificationNow('2026-10-02 10:00')));
    foreach (Policy::IGNORED_STAGES as $stage) {
        $draft = array_replace($checking, ['stage' => $stage]);
        notificationAssert(Policy::isClosed($draft), false, 'A draft is not a completed task');
        notificationAssert(Policy::isIgnored($draft), true, 'Verified unformed stage is ignored');
        $ignored = Policy::evaluate([$draft], 3, $state, notificationNow('2026-10-05 10:00'));
        notificationAssert($ignored['digests'], [], 'Draft produces no deadline, estimate or sold-hours alert');
        notificationAssert($ignored['state']['thresholds'], [], 'Draft cannot retain an overrun crossing');
        notificationAssert($ignored['state']['handoffAlerts'], [], 'Draft cannot retain a Check accusation');
    }
    foreach (['DT1072_18:NEW', 'DT1072_18:UC_L2I5S0'] as $stage) {
        notificationAssert(Policy::isNotificationExcluded(notificationTask(['stage' => $stage])), false, 'Backlog and Hold remain eligible');
    }
};
$cases['Hold preserves ordinary deadline and two-budget routing and delivery deduplication'] = static function (): void {
    $task = notificationTask(['stage' => 'DT1072_18:UC_L2I5S0', 'actual' => 25]);
    $evaluation = Policy::evaluate([$task], 3, [], notificationNow('2026-10-01 10:00'));
    notificationAssert(array_column($evaluation['digests'], 'userId'), [3, 40, 50], 'Hold reaches ordinary three roles');
    notificationAssert(array_keys(notificationUserDigest($evaluation['digests'], 3)['tasks'][0]['reasons']), ['deadline', 'estimate', 'sold'], 'Head sees all Hold reasons');
    notificationAssert(array_keys(notificationUserDigest($evaluation['digests'], 40)['tasks'][0]['reasons']), ['deadline', 'sold'], 'Setter sees deadline and client budget');
    notificationAssert(array_keys(notificationUserDigest($evaluation['digests'], 50)['tasks'][0]['reasons']), ['deadline', 'estimate'], 'Developer sees deadline and estimate');
    $state = notificationDeliverAll($evaluation);
    notificationAssert(Policy::evaluate([$task], 3, $state, notificationNow('2026-10-01 10:01'))['digests'], [], 'Hold does not repeat every minute');
    $tomorrow = Policy::evaluate([$task], 3, $state, notificationNow('2026-10-02 10:00'));
    foreach ($tomorrow['digests'] as $digest) {
        notificationAssert(array_keys($digest['tasks'][0]['reasons']), ['deadline'], 'Only the daily deadline repeats');
    }
};
$cases['Hold deadlines wait for Moscow weekday window while overrun crossing stays immediate'] = static function (): void {
    $task = notificationTask(['stage' => 'DT1072_18:UC_L2I5S0']);
    foreach (['2026-10-02 09:59', '2026-10-03 10:00', '2026-10-04 10:00'] as $time) {
        notificationAssert(Policy::evaluate([$task], 3, [], notificationNow($time))['digests'], [], 'Hold deadline waits outside weekday 10:00 window');
    }
    $overrun = Policy::evaluate([array_replace($task, ['actual' => 25])], 3, [], notificationNow('2026-10-03 08:00'));
    notificationAssert(array_column($overrun['digests'], 'userId'), [3, 40, 50], 'Hold budget crossings are not hidden by the deadline window');
    foreach ($overrun['digests'] as $digest) {
        notificationAssert(isset($digest['tasks'][0]['reasons']['deadline']), false, 'No weekend deadline mixed into budget notice');
    }
};
$cases['ordinary unchanged scan does not mutate state'] = static function (): void {
    $first = Policy::evaluate([notificationTask()], 3, [], notificationNow('2026-10-01 09:00'));
    $stored = json_decode(json_encode($first['state'], JSON_PRESERVE_ZERO_FRACTION), true);
    $second = Policy::evaluate([notificationTask()], 3, $stored, notificationNow('2026-10-01 09:01'));
    notificationAssert($second['state'], $stored, 'No pointless Option rewrite each minute after persisted JSON roundtrip');
};
$cases['message has safe links, all reasons and analyst explanation'] = static function (): void {
    $evaluation = Policy::evaluate([notificationTask(['title' => '[url=https://evil.test]bad[/url]', 'actual' => 25, 'stage' => Policy::CHECK_STAGE])], 3, [], notificationNow('2026-10-01 10:00'));
    $message = Notifications::render($evaluation['digests'][0], notificationNow('2026-10-01 10:00'));
    notificationAssert(strpos($message, '[url=/crm/type/1072/details/1062/]') !== false, true, 'Correct native task link');
    notificationAssert(strpos($message, '[url=https://evil.test]') === false, true, 'Task title cannot inject BBCode');
    notificationAssert(strpos($message, 'На проверке у аналитиков.') !== false, true, 'Responsibility made clear');
    notificationAssert(strpos($message, 'факт 25 / 10 ч') !== false, true, 'Actual/estimate included');
    notificationAssert(strpos($message, 'факт 25 / 20 ч') !== false, true, 'Client limit included separately');
    notificationAssert(strpos($message, '\\n') === false, true, 'No escaped newline appears in message');
};
$cases['large digests retain every complete task within the IM limit'] = static function (): void {
    $tasks = [];
    for ($id = 1; $id <= 100; $id++) {
        $tasks[] = notificationTask(['id' => $id, 'title' => str_repeat('Ж', 1000), 'actual' => 25]);
    }
    $now = notificationNow('2026-10-01 10:00');
    $evaluation = Policy::evaluate($tasks, 3, [], $now);
    $digest = notificationUserDigest($evaluation['digests'], 3);
    $parts = Notifications::renderParts($digest, $now);
    notificationAssert(count($parts) > 1, true, 'A large digest has numbered pages');
    $taskIds = [];
    foreach ($parts as $index => $part) {
        notificationAssert(mb_strlen($part) <= 18000, true, 'Every page stays below CIMMessenger truncation');
        notificationAssert(strpos($part, 'Часть ' . ($index + 1) . ' из ' . count($parts)) !== false, true, 'Page number included');
        preg_match_all('/\[url=\/crm\/type\/1072\/details\/([0-9]+)\/\]/', $part, $matches);
        notificationAssert(count($matches[1]), substr_count($part, 'Сегодня редлайн:'), 'Task rows are not split from deadline reasons');
        notificationAssert(count($matches[1]), substr_count($part, 'Текущая оценка:'), 'Estimate rows stay with task');
        notificationAssert(count($matches[1]), substr_count($part, 'Лимит часов для клиента:'), 'Client limits stay with task');
        foreach ($matches[1] as $id) {
            $taskIds[] = (int)$id;
        }
        notificationAssert(strpos($part, str_repeat('Ж', 251)) === false, true, 'Huge title capped with linked full task available');
    }
    sort($taskIds, SORT_NUMERIC);
    notificationAssert($taskIds, range(1, 100), 'Each original task appears exactly once across pages');
    $small = Policy::evaluate([notificationTask()], 3, [], $now);
    notificationAssert(count(Notifications::renderParts($small['digests'][0], $now)), 1, 'Ordinary digest stays one message');
};
$cases['pending retries freeze only still-valid reasons and recipients'] = static function (): void {
    $task = notificationTask(['actual' => 12, 'sold' => null]);
    $now = notificationNow('2026-10-01 10:00');
    $evaluation = Policy::evaluate([$task], 3, [], $now);
    $original = notificationUserDigest($evaluation['digests'], 50);
    $pending = ['userId' => 50, 'key' => $original['key'], 'partCount' => 1, 'parts' => ['frozen page']];
    $state = $evaluation['state'];
    $state['pendingDigests'][50] = $pending;
    $growth = Policy::evaluate([array_replace($task, ['actual' => 13])], 3, $state, $now);
    notificationAssert(Policy::pendingIsCurrent($pending, notificationUserDigest($growth['digests'], 50)), true, 'Same crossing keeps exact retry body when hours grow');
    foreach ([['stage' => Policy::CHECK_STAGE], ['stage' => 'DT1072_18:UC_6JNSDG'], ['stage' => Policy::IGNORED_STAGES[0]], ['actual' => 9, 'redline' => '2026-10-03'], ['redline' => '2026-10-03']] as $change) {
        $current = Policy::evaluate([array_replace($task, $change)], 3, $state, $now);
        $candidate = notificationUserDigest($current['digests'], 50);
        notificationAssert(Policy::pendingIsCurrent($pending, $candidate === [] ? null : $candidate), false, 'Check/done/draft/correction/date change drops stale pending payload');
    }
    notificationAssert(Policy::pendingIsCurrent(['userId' => 50, 'key' => $original['key'], 'partCount' => 2, 'parts' => ['one']], $original), false, 'Incomplete stored page data cannot count as delivered');
};
$cases['current Check visit validates latest stage category owner and Moscow date'] = static function (): void {
    $task = notificationTask(['stage' => Policy::CHECK_STAGE]);
    $entry = [
        'ID' => 900, 'OWNER_TYPE_ID' => 1072, 'OWNER_ID' => 1062, 'TYPE_ID' => 2,
        'STAGE_ID' => Policy::CHECK_STAGE, 'CATEGORY_ID' => 18,
        'CREATED_TIME' => new DateTimeImmutable('2026-09-30 21:30:00+00:00'),
    ];
    notificationAssert(Policy::currentCheckVisit($task, [$entry]), ['id' => 900, 'date' => '2026-10-01'], 'UTC crossing is the next Moscow calendar day');
    $native = new class {
        public function getTimestamp(): int { return (new DateTimeImmutable('2026-09-30 21:30:00+00:00'))->getTimestamp(); }
    };
    notificationAssert(Policy::currentCheckVisit($task, [array_replace($entry, ['CREATED_TIME' => $native])]), ['id' => 900, 'date' => '2026-10-01'], 'Native Bitrix DateTime timestamp used');
    $rework = array_replace($entry, ['ID' => 901, 'STAGE_ID' => 'DT1072_18:CLIENT']);
    notificationAssert(Policy::currentCheckVisit($task, [$entry, $rework]), null, 'Do not resurrect Check before the latest rework stage');
    foreach ([3, 5] as $newType) {
        $later = array_replace($entry, ['ID' => 901, 'TYPE_ID' => $newType]);
        notificationAssert(Policy::currentCheckVisit($task, [$entry, $later]), null, 'Do not hide a newer finalization/category history row');
    }
    foreach ([['CATEGORY_ID' => 17], ['OWNER_TYPE_ID' => 1060], ['OWNER_ID' => 999], ['TYPE_ID' => 3], ['CREATED_TIME' => ''], ['CREATED_TIME' => '  '], ['CREATED_TIME' => '2026-02-30 12:00']] as $change) {
        notificationAssert(Policy::currentCheckVisit($task, [array_replace($entry, $change)]), null, 'Mismatched or invalid history is unknown');
    }
    $again = array_replace($entry, ['ID' => 902, 'CREATED_TIME' => '2026-10-02 11:30:00']);
    notificationAssert(Policy::currentCheckVisit($task, [$entry, $rework, $again]), ['id' => 902, 'date' => '2026-10-02'], 'Latest Check visit after rework wins');
};
$cases['timely and on-redline Check suppress developer even when self-setter'] = static function (): void {
    foreach (['2026-09-30', '2026-10-01'] as $handoffDate) {
        $task = notificationTask(['stage' => Policy::CHECK_STAGE, 'setters' => [50, 40], 'checkHandoff' => ['id' => 900, 'date' => $handoffDate]]);
        $evaluation = Policy::evaluate([$task], 3, [], notificationNow('2026-10-02 10:00'));
        notificationAssert(array_column($evaluation['digests'], 'userId'), [3, 40], 'Self-setter developer gets no daily review deadline');
        $analyst = notificationUserDigest($evaluation['digests'], 40);
        notificationAssert($analyst['tasks'][0]['reasons']['deadline']['kind'], 'review_overdue', 'Analyst sees review responsibility');
        $message = Notifications::render($analyst, notificationNow('2026-10-02 10:00'));
        notificationAssert(strpos($message, 'Разработчик передал задачу в срок.') !== false, true, 'Developer timeliness explained');
        notificationAssert(strpos($message, 'просрочен на') === false, true, 'Review wait is not described as developer delay');
    }
};
$cases['late Check asks developer and head once independent of daily delivery'] = static function (): void {
    $task = notificationTask(['stage' => Policy::CHECK_STAGE, 'setters' => [50, 40], 'redline' => '2026-09-30', 'checkHandoff' => ['id' => 900, 'date' => '2026-10-01']]);
    $state = ['deadlineSentOn' => ['3' => '2026-10-02', '40' => '2026-10-02', '50' => '2026-10-02']];
    $evaluation = Policy::evaluate([$task], 3, $state, notificationNow('2026-10-02 10:00'));
    notificationAssert(array_column($evaluation['digests'], 'userId'), [3, 50], 'Special handoff does not use the daily recipient ledger');
    foreach ($evaluation['digests'] as $digest) {
        notificationAssert(array_keys($digest['tasks'][0]['reasons']), ['late_handoff'], 'No generic daily overdue added to developer');
    }
    $developer = Notifications::render(notificationUserDigest($evaluation['digests'], 50), notificationNow('2026-10-02 10:00'));
    notificationAssert(strpos($developer, '01.10.2026 после редлайна 30.09.2026') !== false, true, 'Actual Check entry and redline shown');
    notificationAssert(strpos($developer, 'напишите в комментарии') !== false, true, 'Developer asked for explanatory comment');
    $head = Notifications::render(notificationUserDigest($evaluation['digests'], 3), notificationNow('2026-10-02 10:00'));
    notificationAssert(strpos($head, 'Попросите разработчика') !== false, true, 'Head receives an appropriate action');
    $delivered = notificationDeliverAll($evaluation);
    notificationAssert(Policy::evaluate([$task], 3, $delivered, notificationNow('2026-10-02 10:01'))['digests'], [], 'No same-visit minute repeat');
    $tomorrow = Policy::evaluate([$task], 3, $delivered, notificationNow('2026-10-05 10:00'));
    notificationAssert(array_column($tomorrow['digests'], 'userId'), [3, 40], 'Only analyst/head daily waiting reminder repeats');
    notificationAssert(isset(notificationUserDigest($tomorrow['digests'], 3)['tasks'][0]['reasons']['late_handoff']), false, 'Late handoff comment request does not repeat daily');
};
$cases['unknown and future Check history never invents developer lateness'] = static function (): void {
    foreach ([null, ['id' => 900, 'date' => 'bad'], ['id' => 0, 'date' => '2026-10-01'], ['id' => 900, 'date' => '2026-10-03']] as $handoff) {
        $task = notificationTask(['stage' => Policy::CHECK_STAGE, 'setters' => [50, 40], 'redline' => '2026-09-30', 'checkHandoff' => $handoff]);
        $evaluation = Policy::evaluate([$task], 3, [], notificationNow('2026-10-02 10:00'));
        notificationAssert(array_column($evaluation['digests'], 'userId'), [3, 40], 'No unsupported developer accusation');
        foreach ($evaluation['digests'] as $digest) {
            notificationAssert(isset($digest['tasks'][0]['reasons']['late_handoff']), false, 'Special reason needs an actual known past visit');
        }
    }
};
$cases['new Check cycle and redline correction rearm only the relevant handoff'] = static function (): void {
    $task = notificationTask(['stage' => Policy::CHECK_STAGE, 'setters' => [50, 40], 'redline' => '2026-09-30', 'checkHandoff' => ['id' => 900, 'date' => '2026-10-01']]);
    $first = Policy::evaluate([$task], 3, [], notificationNow('2026-10-02 10:00'));
    $state = notificationDeliverAll($first);
    $newVisit = array_replace($task, ['checkHandoff' => ['id' => 901, 'date' => '2026-10-02']]);
    $again = Policy::evaluate([$newVisit], 3, $state, notificationNow('2026-10-02 10:01'));
    notificationAssert(array_column($again['digests'], 'userId'), [3, 50], 'New Check entry has a new independent comment request');
    $original = notificationUserDigest($first['digests'], 50);
    $pending = ['userId' => 50, 'key' => $original['key'], 'partCount' => 1, 'parts' => ['frozen']];
    notificationAssert(Policy::pendingIsCurrent($pending, notificationUserDigest($again['digests'], 50)), false, 'Old-visit frozen pages cannot survive a new visit');
    $timely = array_replace($task, ['redline' => '2026-10-02']);
    $corrected = Policy::evaluate([$timely], 3, $state, notificationNow('2026-10-02 10:01'));
    notificationAssert(notificationUserDigest($corrected['digests'], 50), [], 'Extended redline removes developer late notice');
    notificationAssert(Policy::pendingIsCurrent($pending, null), false, 'Corrected redline discards old late payload');
};
$cases['late handoff follows weekday window and head-assignee collision deduplicates'] = static function (): void {
    $task = notificationTask(['stage' => Policy::CHECK_STAGE, 'assignee' => 3, 'setters' => [3], 'redline' => '2026-09-30', 'checkHandoff' => ['id' => 900, 'date' => '2026-10-01']]);
    foreach (['2026-10-02 09:59', '2026-10-03 11:00'] as $time) {
        notificationAssert(Policy::evaluate([$task], 3, [], notificationNow($time))['digests'], [], 'No late comment request outside deadline window');
    }
    $evaluation = Policy::evaluate([$task], 3, [], notificationNow('2026-10-02 10:00'));
    notificationAssert(array_column($evaluation['digests'], 'userId'), [3], 'Head/developer overlap gives one digest');
    notificationAssert(array_keys($evaluation['digests'][0]['tasks'][0]['reasons']), ['deadline', 'late_handoff'], 'Head daily responsibility retained with separate late reason');
};

foreach ($cases as $name => $test) {
    $test();
    echo "PASS " . $name . "\n";
}
echo count($cases) . " notification tests passed\n";
