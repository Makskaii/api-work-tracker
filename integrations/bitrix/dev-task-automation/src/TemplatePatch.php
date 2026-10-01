<?php
declare(strict_types=1);

namespace Evolution\DevTaskAutomation;

use RuntimeException;

final class TemplatePatch
{
    public const GUARD_NAME = 'EvolutionDevTaskGuardV1';

    public static function apply(array $template): array
    {
        if (count($template) !== 1 || ($template[0]['Type'] ?? '') !== 'SequentialWorkflowActivity') {
            throw new RuntimeException('Unexpected workflow root; refusing to change the template.');
        }
        $original = $template[0]['Children'] ?? [];
        if (($original[0]['Name'] ?? '') === self::GUARD_NAME) {
            return $template;
        }
        if (!$original) {
            throw new RuntimeException('Empty workflow; refusing to replace existing automation.');
        }
        $template[0]['Children'] = [
            [
                'Type' => 'EvolutionDevTaskGuard',
                'Name' => self::GUARD_NAME,
                'Properties' => [
                    'Title' => 'Одна задача в работе: проверка и возврат',
                    'PreviousStageId' => '{=Document:PREVIOUS_STAGE_ID}',
                ],
                'Children' => [],
            ],
            [
                'Type' => 'IfElseActivity',
                'Name' => 'EvolutionDevTaskEntryAllowedV1',
                'Properties' => ['Title' => 'Разрешён переход в работу'],
                'Children' => [
                    [
                        'Type' => 'IfElseBranchActivity',
                        'Name' => 'EvolutionDevTaskAllowedBranchV1',
                        'Properties' => [
                            'Title' => 'Переход разрешён: существующие действия',
                            'mixedcondition' => [[
                                'object' => self::GUARD_NAME,
                                'field' => 'Allowed',
                                'operator' => '=',
                                'value' => 'Y',
                                'joiner' => '0',
                            ]],
                        ],
                        'Children' => $original,
                    ],
                    [
                        'Type' => 'IfElseBranchActivity',
                        'Name' => 'EvolutionDevTaskRejectedBranchV1',
                        'Properties' => [
                            'Title' => 'Возврат: завершить без действий стадии «В работе»',
                            'truecondition' => [],
                        ],
                        'Children' => [],
                    ],
                ],
            ],
        ];
        return $template;
    }
}
