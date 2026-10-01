<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$mode = $argv[1] ?? 'check';
$documentRoot = $argv[2] ?? '/home/bitrix/www';
$backupDir = $argv[3] ?? '';
if (!in_array($mode, ['check', 'apply', 'restore'], true)) {
    throw new RuntimeException('Mode must be check, apply or restore.');
}
$_SERVER['DOCUMENT_ROOT'] = $documentRoot;
define('NO_KEEP_STATISTIC', true);
define('NOT_CHECK_PERMISSIONS', true);
define('NO_AGENT_CHECK', true);
define('DisableEventsCheck', true);
require $documentRoot . '/bitrix/modules/main/include/prolog_before.php';
require dirname(__DIR__) . '/bootstrap.php';

use Bitrix\Main\Loader;
use Bitrix\Main\Config\Option;
use Evolution\DevTaskAutomation\DeliveryMode;
use Evolution\DevTaskAutomation\TemplatePatch;

if (!Loader::includeModule('bizproc') || !Loader::includeModule('crm')) {
    throw new RuntimeException('CRM and bizproc modules are required.');
}
if ($mode !== 'check') {
    // Match the user who requested the change, without changing access rules.
    global $USER;
    if (!$USER->authorize(3)) {
        throw new RuntimeException('Could not establish the configuration author.');
    }
}
$templateId = 217;
$agentNames = [
    '\\Evolution\\DevTaskAutomation\\Notifications::agent();',
    '\\Evolution\\DevTaskAutomation\\GuardRetry::agent();',
];
$loader = CBPWorkflowTemplateLoader::getLoader();
$current = $loader::getList([], ['ID' => $templateId])->fetch();
if (!$current || ($current['DOCUMENT_TYPE'][2] ?? '') !== 'DYNAMIC_1072') {
    throw new RuntimeException('Template 217 is not the expected Development workflow.');
}
$agents = [];
foreach ($agentNames as $agentName) {
    $agents[$agentName] = CAgent::getList([], ['NAME' => $agentName])->fetch() ?: null;
}
$deliveryOptions = [
    'delivery_mode' => Option::get(DeliveryMode::MODULE, 'delivery_mode', ''),
    'preview_recipient_id' => Option::get(DeliveryMode::MODULE, 'preview_recipient_id', ''),
];

if ($mode === 'restore') {
    $snapshot = json_decode(file_get_contents($backupDir . '/configuration.json'), true, 512, JSON_THROW_ON_ERROR);
    if (!$loader::update($templateId, ['TEMPLATE' => $snapshot['template']['TEMPLATE'], 'MODIFIER_USER' => 3])) {
        throw new RuntimeException('Could not restore the workflow.');
    }
    foreach ($agents as $agentName => $agent) {
        $old = $snapshot['agents'][$agentName] ?? null;
        if ($agent && !$old) {
            CAgent::delete((int)$agent['ID']);
        } elseif ($agent && $old) {
            CAgent::update((int)$agent['ID'], [
                'ACTIVE' => $old['ACTIVE'], 'AGENT_INTERVAL' => $old['AGENT_INTERVAL'],
                'IS_PERIOD' => $old['IS_PERIOD'],
            ]);
        }
    }
    foreach ($snapshot['deliveryOptions'] ?? [] as $name => $value) {
        if ($value === '') { Option::delete(DeliveryMode::MODULE, ['name' => $name]); }
        else { Option::set(DeliveryMode::MODULE, $name, $value); }
    }
    \Bitrix\Main\Application::getInstance()->getManagedCache()
        ->clean('b_option:' . DeliveryMode::MODULE, 'b_option');
    echo "Workflow and agent configuration restored. Restore deployment files from the same backup separately.\n";
    exit;
}

$patched = TemplatePatch::apply($current['TEMPLATE']);
$errors = $loader->validateTemplate($patched[0], new CBPWorkflowTemplateUser(3));
if ($errors) {
    throw new RuntimeException('Workflow validation failed: ' . json_encode($errors, JSON_UNESCAPED_UNICODE));
}

if ($mode === 'check') {
    echo json_encode([
        'template' => $templateId,
        'valid' => true,
        'guardAlreadyInstalled' => $patched === $current['TEMPLATE'],
        'existingRootActivities' => count($current['TEMPLATE'][0]['Children']),
        'existingAgents' => array_map(static fn($agent) => $agent ? (int)$agent['ID'] : null, $agents),
        'deliveryMode' => DeliveryMode::key(),
        'previewRecipient' => DeliveryMode::previewRecipient(),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit;
}

$realBackup = $backupDir ? realpath($backupDir) : false;
$realRoot = realpath($documentRoot);
if (!$realBackup || !$realRoot || !is_dir($backupDir)
    || $realBackup === $realRoot || str_starts_with($realBackup, $realRoot . '/')) {
    throw new RuntimeException('A private backup directory outside the web root is required.');
}
$snapshotFile = $backupDir . '/configuration.json';
if (!file_exists($snapshotFile)) {
    $export = $loader::exportTemplate($templateId);
    $snapshot = json_encode(['template' => $current, 'agents' => $agents, 'deliveryOptions' => $deliveryOptions], JSON_THROW_ON_ERROR);
    if (!$export || !chmod($backupDir, 0700)
        || file_put_contents($snapshotFile, $snapshot) !== strlen($snapshot)
        || !chmod($snapshotFile, 0600)
        || file_put_contents($backupDir . '/template-217.bpt', $export) !== strlen($export)
        || !chmod($backupDir . '/template-217.bpt', 0600)) {
        throw new RuntimeException('Private workflow backup failed; nothing will be configured.');
    }
}
$connection = \Bitrix\Main\Application::getConnection();
$connection->startTransaction();
try {
    // Current human instruction: route every new notification only to Artem.
    Option::set(DeliveryMode::MODULE, 'delivery_mode', 'preview');
    Option::set(DeliveryMode::MODULE, 'preview_recipient_id', '3');
    if (!$loader::update($templateId, ['TEMPLATE' => $patched, 'MODIFIER_USER' => 3])) {
        throw new RuntimeException('Could not update the workflow.');
    }
    $ids = [];
    foreach ($agents as $agentName => $agent) {
        if (!$agent) {
            $id = CAgent::addAgent($agentName, '', 'N', 60, '', 'Y', ConvertTimeStamp(time() + 120, 'FULL'), 100, false);
            if (!$id) {
                throw new RuntimeException('Automation agent could not be registered.');
            }
        } else {
            if (!CAgent::update((int)$agent['ID'], ['ACTIVE' => 'Y', 'AGENT_INTERVAL' => 60, 'IS_PERIOD' => 'N'])) {
                throw new RuntimeException('Automation agent could not be updated.');
            }
            $id = (int)$agent['ID'];
        }
        $ids[$agentName] = $id;
    }
    $connection->commitTransaction();
} catch (Throwable $error) {
    $connection->rollbackTransaction();
    throw $error;
}
// Option::set clears managed cache before commit. A concurrent scheduler
// can refill it with the old committed values; clear again after commit.
\Bitrix\Main\Application::getInstance()->getManagedCache()
    ->clean('b_option:' . DeliveryMode::MODULE, 'b_option');
echo json_encode(['template' => $templateId, 'agents' => $ids, 'installed' => true], JSON_PRETTY_PRINT) . "\n";
