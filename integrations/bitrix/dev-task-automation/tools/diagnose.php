<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$_SERVER['DOCUMENT_ROOT'] = $argv[1] ?? '/home/bitrix/www';
define('NO_KEEP_STATISTIC', true);
define('NOT_CHECK_PERMISSIONS', true);
define('NO_AGENT_CHECK', true);
define('DisableEventsCheck', true);
// Prefer the candidate integration during a staged dry run, before init.php
// registers the installed version's autoloader.
require dirname(__DIR__) . '/bootstrap.php';
require $_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_before.php';

use Evolution\DevTaskAutomation\GuardPolicy;
use Evolution\DevTaskAutomation\Notifications;
use Evolution\DevTaskAutomation\WorkInProgressGuard;

$result = Notifications::run(null, true);
$summaries = [];
foreach ($result['digests'] as $digest) {
    $summaries[] = array_diff_key($digest, ['message' => true]) + ['messageLength' => mb_strlen($digest['message'])];
}
$result['digests'] = $summaries;
if (isset($result['error'])) { throw new RuntimeException($result['error']); }

// Inspect real metadata/history without invoking the guard's mutating entry.
$factory = \Bitrix\Crm\Service\Container::getInstance()->getFactory(1072);
$guard = new WorkInProgressGuard();
$metadataMethod = new ReflectionMethod($guard, 'stages');
$historyMethod = new ReflectionMethod($guard, 'history');
$snapshotMethod = new ReflectionMethod($guard, 'snapshot');
$stages = $metadataMethod->invoke($guard, $factory);
$items = $factory->getItems(['filter' => ['@STAGE_ID' => array_values($stages['inWork'])]]);
$entries = [];
foreach ($items as $item) {
    $snapshot = $snapshotMethod->invoke($guard, $item);
    $history = $historyMethod->invoke($guard, $item->getId());
    $transition = GuardPolicy::transition($snapshot, $history);
    $entries[] = [
        'id' => $item->getId(), 'assignee' => $item->getAssignedById(),
        'transitionFound' => $transition !== null,
        'previousStage' => GuardPolicy::returnTarget($snapshot, $history, '', $stages),
    ];
}
echo json_encode(['notifications' => $result, 'currentInWork' => $entries], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
