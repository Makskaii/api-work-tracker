<?php
declare(strict_types=1);

namespace Evolution\DevTaskAutomation;

use Bitrix\Main\Config\Option;

/** Preview is the safe default; live delivery requires an explicit configuration change. */
final class DeliveryMode
{
    public const MODULE = 'evolution.dev.tasks';

    public static function isPreview(): bool
    {
        return Option::get(self::MODULE, 'delivery_mode', 'preview') !== 'live';
    }

    public static function previewRecipient(): int
    {
        $id = filter_var(Option::get(self::MODULE, 'preview_recipient_id', '3'), FILTER_VALIDATE_INT);
        return $id !== false && $id > 0 ? $id : 3;
    }

    public static function target(int $intendedRecipient): int
    {
        return self::isPreview() ? self::previewRecipient() : $intendedRecipient;
    }

    public static function key(): string
    {
        return self::isPreview() ? 'preview_' . self::previewRecipient() : 'live';
    }

    public static function prefix(int $intendedRecipient): string
    {
        if (!self::isPreview()) { return ''; }
        $name = 'Сотрудник №' . $intendedRecipient;
        if (class_exists('CUser')) {
            $user = \CUser::GetByID($intendedRecipient)->Fetch();
            if ($user) {
                $display = trim(($user['NAME'] ?? '') . ' ' . ($user['LAST_NAME'] ?? ''));
                if ($display !== '') { $name = $display; }
            }
        }
        $name = str_replace(['[', ']', "\r", "\n"], ['［', '］', '', ' '], $name);
        return '[b]Проверка уведомлений[/b]' . "\n"
            . 'Получатель в рабочем режиме: ' . $name . '.' . "\n\n";
    }
}
