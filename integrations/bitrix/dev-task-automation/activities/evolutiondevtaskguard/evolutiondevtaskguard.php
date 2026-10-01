<?php

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true) {
    die();
}

/** Installed as the first action on the development task's In work stage. */
class CBPEvolutionDevTaskGuard extends CBPActivity
{
    public function __construct($name)
    {
        parent::__construct($name);
        $this->arProperties = ['Title' => '', 'PreviousStageId' => '', 'Allowed' => false, 'Reason' => ''];
        $this->SetPropertiesTypes([
            'Allowed' => ['Type' => 'bool'],
            'Reason' => ['Type' => 'string'],
        ]);
    }

    public function Execute()
    {
        $this->Allowed = false;
        $this->Reason = 'Проверка одной задачи в работе не выполнена.';
        try {
            $bootstrap = rtrim((string)$_SERVER['DOCUMENT_ROOT'], '/') . '/local/php_interface/evolution/dev_tasks/bootstrap.php';
            if (!is_file($bootstrap)) {
                throw new RuntimeException('Модуль проверки задач не установлен.');
            }
            require_once $bootstrap;
            $itemId = \Evolution\DevTaskAutomation\GuardPolicy::itemIdFromDocument($this->GetDocumentId());
            if ($itemId === null) {
                throw new RuntimeException('Проверка работает только для смарт-процесса задач разработки.');
            }
            $result = (new \Evolution\DevTaskAutomation\WorkInProgressGuard())->check($itemId, (string)$this->PreviousStageId);
            $this->Allowed = (bool)$result['allowed'];
            $this->Reason = (string)$result['reason'];
        } catch (Throwable $exception) {
            // Never write exception dumps: connection and auth data may be present.
            $this->Reason = 'Не удалось проверить занятость ответственного. Повторите перенос или обратитесь к администратору.';
        }
        $this->WriteToTrackingService($this->Reason);
        return CBPActivityExecutionStatus::Closed;
    }

    public static function GetPropertiesDialog($documentType, $activityName, $arWorkflowTemplate, $arWorkflowParameters, $arWorkflowVariables, $arCurrentValues = null, $formName = '')
    {
        return '<p>Первое действие на стадии «В работе». Предыдущая стадия берётся из истории задачи. '
            . 'После проверки продолжайте действия только при результате «Можно работать над задачей = Да».</p>';
    }

    public static function GetPropertiesDialogValues($documentType, $activityName, &$arWorkflowTemplate, &$arWorkflowParameters, &$arWorkflowVariables, $arCurrentValues, &$errors)
    {
        $errors = [];
        $activity = &CBPWorkflowTemplateLoader::FindActivityByName($arWorkflowTemplate, $activityName);
        $activity['Properties']['PreviousStageId'] = '{=Document:PREVIOUS_STAGE_ID}';
        return true;
    }
}
