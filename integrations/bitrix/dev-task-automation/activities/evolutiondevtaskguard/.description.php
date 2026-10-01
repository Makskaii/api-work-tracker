<?php

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) {
    die();
}

$arActivityDescription = [
    'NAME' => 'Проверить одну задачу в работе',
    'DESCRIPTION' => 'Возвращает новую задачу на исходную стадию, если у ответственного уже есть задача в работе.',
    'TYPE' => 'activity',
    'CLASS' => 'EvolutionDevTaskGuard',
    'JSCLASS' => 'BizProcActivity',
    'CATEGORY' => ['ID' => 'crm'],
    'ROBOT_SETTINGS' => ['GROUP' => ['employeeControl'], 'SORT' => 110],
    'RETURN' => [
        'Allowed' => ['NAME' => 'Можно работать над задачей', 'TYPE' => 'bool'],
        'Reason' => ['NAME' => 'Результат проверки', 'TYPE' => 'string'],
    ],
];
