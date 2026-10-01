<?php

namespace Evolution\DevTaskAutomation;

use Bitrix\Crm\History\Entity\EntityStageHistoryTable;
use Bitrix\Crm\Item;
use Bitrix\Crm\Service\Container;
use Bitrix\Crm\Service\Factory;
use Bitrix\Crm\Service\Operation;
use Bitrix\Main\Application;
use Bitrix\Main\Error;
use Bitrix\Main\Loader;
use Bitrix\Main\Result;

/** Narrow adapter called only by the first In work activity for type 1072. */
final class WorkInProgressGuard
{
    /**
     * Returns allowed/reason plus diagnostic IDs and a visible rejection notice.
     * The workflow must call it on stage entry, not as a bulk repair of old tasks.
     */
    public function check(int $itemId, string $previousStageId = '', ?array $pendingAttempt = null): array
    {
        $pendingAttempt = $pendingAttempt ?? GuardRetry::continuationAttempt($itemId);
        try {
            $outcome = $this->inspect($itemId, $previousStageId, $pendingAttempt);
            GuardRetry::recordContinuationOutcome($itemId, $outcome);
            return $outcome;
        } catch (\Throwable $exception) {
            // Try to retain only this attempted transition, never enumerate and
            // repair all existing duplicates after an infrastructure error.
            $fingerprint = $pendingAttempt;
            if ($fingerprint === null) {
                try {
                    $factory = Loader::includeModule('crm') ? Container::getInstance()->getFactory(GuardPolicy::ENTITY_TYPE_ID) : null;
                    $item = $factory ? $factory->getItem($itemId) : null;
                    if ($item) {
                        $snapshot = $this->snapshot($item);
                        $fingerprint = GuardPolicy::fingerprint($snapshot, GuardPolicy::transition($snapshot, $this->history($itemId)));
                    }
                } catch (\Throwable $readFailure) {
                    // No raw error details are persisted.
                }
            }
            GuardRetry::log($itemId, 'Проверка одной задачи в работе завершилась ошибкой.');
            if ($fingerprint !== null && (int)$fingerprint['assignee'] > 0) {
                $outcome = $this->reject($fingerprint, $previousStageId, 'Не удалось проверить занятость ответственного.', null, false, (int)$fingerprint['historyId'] > 0);
                GuardRetry::recordContinuationOutcome($itemId, $outcome);
                return $outcome;
            }
            return $this->result(false, 'Не удалось проверить занятость ответственного. Повторите перенос или обратитесь к администратору.');
        }
    }

    private function inspect(int $itemId, string $previousStageId, ?array $pendingAttempt): array
    {
        if ($itemId <= 0 || !Loader::includeModule('crm')) {
            return $this->result(false, 'Не удалось проверить задачу: неверный документ.');
        }
        $factory = Container::getInstance()->getFactory(GuardPolicy::ENTITY_TYPE_ID);
        if (!$factory) {
            return $this->result(false, 'Смарт-процесс задач разработки недоступен.');
        }
        $stages = $this->stages($factory);
        $item = $factory->getItem($itemId);
        if (!$item) {
            return $this->result(false, 'Задача больше не существует.');
        }
        $snapshot = $this->snapshot($item);
        if (!in_array($snapshot['stage'], $stages['inWork'], true)) {
            return $this->stale('Стадия уже изменена; проверка входа в работу пропущена.');
        }
        if ($snapshot['assignee'] <= 0) {
            return $this->result(false, 'Для работы у задачи должен быть ответственный.');
        }
        $history = $this->history($itemId);
        $transition = GuardPolicy::transition($snapshot, $history);
        if (!$transition) {
            // The installed operation writes history before starting this BP.
            // Two short rereads handle a delayed visibility edge without a busy loop.
            for ($attempt = 0; $attempt < 2 && !$transition; ++$attempt) {
                usleep(10000);
                $history = $this->history($itemId);
                $transition = GuardPolicy::transition($snapshot, $history);
            }
        }
        if (!$transition) {
            if ($pendingAttempt !== null) {
                $visibleFields = GuardPolicy::fingerprint($snapshot, null);
                $expectedFields = $pendingAttempt;
                $expectedFields['historyId'] = 0;
                if ($visibleFields !== $expectedFields) {
                    return $this->stale('Задача уже изменена; старый переход не будет отменён.');
                }
                // Keep the original verified ID; never rebind it to a later row.
                return $this->reject($pendingAttempt, $previousStageId, 'Не удалось подтвердить историю исходного перехода.', null, false, true);
            }
            return $this->reject(GuardPolicy::fingerprint($snapshot, null), $previousStageId, 'История перехода недоступна. Верните задачу на исходную стадию вручную и повторите перенос.', null, false, false);
        }
        if ($pendingAttempt !== null && !GuardPolicy::samePendingTransition($pendingAttempt, $snapshot, $transition)) {
            return $this->stale('Задача уже изменена; старый переход не будет отменён.');
        }
        $expected = GuardPolicy::fingerprint($snapshot, $transition);
        $connection = Application::getConnection();
        $lockName = 'evolution_dev_wip_1072_' . $snapshot['assignee'];
        if (!$connection->lock($lockName, 5)) {
            return $this->reject($expected, $previousStageId, 'Проверка другой задачи ещё выполняется.', null, false, true);
        }
        try {
            // The named lock serializes checks. CRM writers do not share that
            // lock, so verify the attempted transition again before any write.
            $item = $factory->getItem($itemId);
            $history = $this->history($itemId);
            if (!$item || !GuardPolicy::sameTransition($expected, $this->snapshot($item), GuardPolicy::transition($this->snapshot($item), $history))) {
                return $this->stale('Задача уже изменена; старый переход не будет отменён.');
            }
            $snapshot = $this->snapshot($item);
            $candidates = [];
            $items = $factory->getItems([
                'select' => ['ID', 'TITLE', 'STAGE_ID', 'CATEGORY_ID', 'ASSIGNED_BY_ID', 'MOVED_TIME'],
                'filter' => ['=ASSIGNED_BY_ID' => $snapshot['assignee'], '@STAGE_ID' => array_values($stages['inWork'])],
            ]);
            foreach ($items as $candidate) {
                $candidateSnapshot = $this->snapshot($candidate);
                $entry = GuardPolicy::transition($candidateSnapshot, $this->history($candidate->getId()));
                $candidates[] = [
                    'id' => $candidate->getId(), 'title' => $candidate->getTitle(),
                    'entryId' => (int)($entry['id'] ?? 0), 'entryTime' => $entry['time'] ?? 0,
                ];
            }
            $winnerId = GuardPolicy::winner($candidates);
            if ($winnerId === null) {
                return $this->stale('Задача уже покинула стадию «В работе».');
            }
            if ($winnerId === $itemId) {
                if ($pendingAttempt === null && !GuardRetry::completeNormalAttempt($expected)) {
                    return $this->result(false, 'Продолжение действий стадии уже выполняется или ожидает проверки администратора.');
                }
                return $this->result(true, 'Задача может оставаться в работе.');
            }
            $target = GuardPolicy::returnTarget($snapshot, $history, trim($previousStageId), $stages);
            if (!$target) {
                return $this->reject($expected, $previousStageId, 'У ответственного уже есть задача в работе, но исходная стадия недоступна. Перенесите эту задачу вручную.', $winnerId, false, true);
            }

            // Fresh item changes only stage/category, preserving concurrent edits
            // to descriptions, estimates and other task fields.
            $item = $factory->getItem($itemId);
            $currentHistory = $this->history($itemId);
            if (!$item || !GuardPolicy::sameTransition($expected, $this->snapshot($item), GuardPolicy::transition($this->snapshot($item), $currentHistory))) {
                return $this->stale('Задача уже изменена; старый переход не будет отменён.');
            }
            $item->setStageId($target['stage']);
            if ($item->getCategoryId() !== $target['category']) {
                $item->setCategoryId($target['category']);
            }
            $operation = $factory->getUpdateOperation($item);
            $operation->disableAutomation()->disableBizProc()->disableCheckRequiredUserFields();
            // This system rollback follows the same permission-independent
            // document update semantics as the installed Bitrix BP provider.
            // Only the validated 1072 item/stage is modified; all other checks stay.
            $operation->disableCheckAccess();
            $guard = $this;
            $operation->addAction(Operation::ACTION_BEFORE_SAVE, new class($guard, $factory, $expected) extends Operation\Action {
                private WorkInProgressGuard $guard;
                private Factory $factory;
                private array $expected;

                public function __construct(WorkInProgressGuard $guard, Factory $factory, array $expected)
                {
                    $this->guard = $guard;
                    $this->factory = $factory;
                    $this->expected = $expected;
                }

                public function process(Item $item): Result
                {
                    $result = new Result();
                    if (!$this->guard->isCurrent($this->factory, $this->expected)) {
                        $result->addError(new Error('Задача изменилась во время проверки. Исходный перенос не отменён.', 'EVOLUTION_WIP_STALE'));
                    }
                    return $result;
                }
            });
            $result = $operation->launch();
            if (!$result->isSuccess()) {
                foreach ($result->getErrors() as $error) {
                    if ($error->getCode() === 'EVOLUTION_WIP_STALE') {
                        return $this->stale('Задача изменилась во время проверки; старый переход не отменён.');
                    }
                }
                return $this->reject($expected, $previousStageId, 'Не удалось вернуть задачу на исходную стадию. Обратитесь к администратору.', $winnerId, false, true);
            }
            return $this->reject($expected, $previousStageId, 'У ответственного уже в работе задача №' . $winnerId . '. Эта задача возвращена на исходную стадию.', $winnerId, true, false);
        } finally {
            $connection->unlock($lockName);
        }
    }

    /** Read-only final validation used by the operation's before-save action. */
    public function isCurrent(Factory $factory, array $expected): bool
    {
        $item = $factory->getItem($expected['id']);
        if (!$item) {
            return false;
        }
        $snapshot = $this->snapshot($item);
        return GuardPolicy::sameTransition($expected, $snapshot, GuardPolicy::transition($snapshot, $this->history($item->getId())));
    }

    private function snapshot(Item $item): array
    {
        return [
            'id' => $item->getId(), 'stage' => $item->getStageId(),
            'category' => $item->getCategoryId(), 'assignee' => $item->getAssignedById(),
            'movedAt' => $item->getMovedTime(),
        ];
    }

    private function history(int $itemId): array
    {
        $rows = EntityStageHistoryTable::getList([
            'select' => ['ID', 'TYPE_ID', 'STAGE_ID', 'CATEGORY_ID', 'CREATED_TIME'],
            'filter' => ['=OWNER_TYPE_ID' => GuardPolicy::ENTITY_TYPE_ID, '=OWNER_ID' => $itemId],
            'order' => ['ID' => 'DESC'], 'limit' => 20,
        ])->fetchAll();
        return array_map(static function (array $row): array {
            return [
                'id' => (int)$row['ID'], 'type' => (int)$row['TYPE_ID'],
                'stage' => (string)$row['STAGE_ID'], 'category' => (int)$row['CATEGORY_ID'],
                'time' => GuardPolicy::timestamp($row['CREATED_TIME']),
            ];
        }, $rows);
    }

    private function stages(Factory $factory): array
    {
        $metadata = [];
        foreach ($factory->getCategories() as $category) {
            $rows = [];
            foreach ($factory->getStages($category->getId()) as $stage) {
                $rows[] = [
                    'id' => $stage->getStatusId(), 'name' => $stage->getName(),
                    'sort' => $stage->getSort(), 'semantic' => $stage->getSemantics(),
                ];
            }
            $metadata[$category->getId()] = $rows;
        }
        return GuardPolicy::stages($metadata);
    }

    private function result(bool $allowed, string $reason, ?int $conflictId = null, bool $reverted = false): array
    {
        return ['allowed' => $allowed, 'reason' => $reason, 'conflictId' => $conflictId, 'reverted' => $reverted, 'retryNeeded' => false, 'stale' => false];
    }

    private function stale(string $reason): array
    {
        $result = $this->result(false, $reason);
        $result['stale'] = true;
        return $result;
    }

    private function reject(array $fingerprint, string $previousStageId, string $reason, ?int $conflictId, bool $reverted, bool $retry): array
    {
        try {
            if ($retry) {
                GuardRetry::defer($fingerprint, $previousStageId);
                $reason .= ' Повторная проверка запланирована автоматически.';
            } else {
                GuardRetry::complete($fingerprint);
            }
        } catch (\Throwable $exception) {
            GuardRetry::log((int)$fingerprint['id'], 'Не удалось сохранить повторную проверку задачи.');
            if (!$reverted) {
                $reason .= ' Перенесите задачу вручную и сообщите администратору.';
            }
        }
        try {
            GuardRetry::notify($fingerprint, $reason, $reverted);
        } catch (\Throwable $exception) {
            GuardRetry::log((int)$fingerprint['id'], 'Не удалось показать ответственному результат проверки задачи.');
        }
        $result = $this->result(false, $reason, $conflictId, $reverted);
        $result['retryNeeded'] = $retry;
        return $result;
    }
}
