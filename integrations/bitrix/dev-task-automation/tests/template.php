<?php
declare(strict_types=1);
require dirname(__DIR__) . '/bootstrap.php';

use Evolution\DevTaskAutomation\TemplatePatch;

$existing = [['Type' => 'SequentialWorkflowActivity', 'Name' => 'Template',
    'Properties' => ['Title' => 'Existing'], 'Children' => [
        ['Type' => 'SetFieldActivity', 'Name' => 'original', 'Properties' => ['A' => 'B']],
        ['Type' => 'IfElseActivity', 'Name' => 'originalBranch', 'Children' => []],
    ]]];
$patched = TemplatePatch::apply($existing);
if ($patched[0]['Children'][1]['Children'][0]['Children'] !== $existing[0]['Children']) {
    throw new RuntimeException('Existing activities were changed.');
}
if (TemplatePatch::apply($patched) !== $patched) {
    throw new RuntimeException('Repeated installation duplicated the guard.');
}
foreach ([[], [['Type' => 'StateMachineWorkflowActivity']], [['Type' => 'SequentialWorkflowActivity']]] as $bad) {
    try { TemplatePatch::apply($bad); } catch (RuntimeException $e) { continue; }
    throw new RuntimeException('Unexpected template was accepted.');
}
echo "Template preservation, idempotence and invalid-root checks passed.\n";
