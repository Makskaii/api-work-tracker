<?php
declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $prefix = 'Evolution\\DevTaskAutomation\\';
    if (str_starts_with($class, $prefix)) {
        $file = __DIR__ . '/src/' . substr($class, strlen($prefix)) . '.php';
        if (is_file($file)) {
            require_once $file;
        }
    }
});
