<?php

namespace Evolution\DevTaskAutomation;

/** Pure decisions for the one-task-in-work rule. No Bitrix calls or writes. */
final class GuardPolicy
{
    public const ENTITY_TYPE_ID = 1072;
    public const VERIFIED_IN_WORK_STAGES = [18 => 'DT1072_18:CLIENT'];

    public static function itemIdFromDocument(array $documentId): ?int
    {
        if (($documentId[0] ?? '') !== 'crm'
            || ($documentId[1] ?? '') !== 'Bitrix\\Crm\\Integration\\BizProc\\Document\\Dynamic'
            || !preg_match('/^DYNAMIC_1072_([1-9][0-9]*)$/D', (string)($documentId[2] ?? ''), $matches)) {
            return null;
        }
        return (int)$matches[1];
    }

    /**
     * Metadata contains category => [{id,name,sort,semantic}]. Never infer a
     * stage from the CLIENT suffix in another category: read its actual name.
     */
    public static function stages(array $metadata): array
    {
        $inWork = [];
        $initial = [];
        $categoryByStage = [];
        foreach ($metadata as $categoryId => $stages) {
            $categoryId = (int)$categoryId;
            usort($stages, static function (array $a, array $b): int {
                return [(int)$a['sort'], (string)$a['id']] <=> [(int)$b['sort'], (string)$b['id']];
            });
            $matches = [];
            foreach ($stages as $stage) {
                $id = (string)$stage['id'];
                $categoryByStage[$id] = $categoryId;
                if (!isset($initial[$categoryId]) && !in_array($stage['semantic'] ?? '', ['S', 'F'], true)) {
                    $initial[$categoryId] = $id;
                }
                $name = mb_strtolower(trim(preg_replace('/\s+/u', ' ', (string)$stage['name'])));
                if ($id === (self::VERIFIED_IN_WORK_STAGES[$categoryId] ?? null)
                    || in_array($name, ['в работе', 'in work', 'inwork'], true)) {
                    $matches[$id] = $id;
                }
            }
            if (count($matches) > 1) {
                throw new \RuntimeException('В воронке несколько стадий «В работе»: нужна явная настройка.');
            }
            if ($matches) {
                $inWork[$categoryId] = array_values($matches)[0];
            }
        }
        return ['inWork' => $inWork, 'initial' => $initial, 'categoryByStage' => $categoryByStage];
    }

    public static function timestamp($value): int
    {
        if (is_object($value) && method_exists($value, 'getTimestamp')) {
            return (int)$value->getTimestamp();
        }
        if (is_int($value)) {
            return $value;
        }
        if (!is_string($value) || trim($value) === '') {
            return 0;
        }
        try {
            return (new \DateTimeImmutable($value))->getTimestamp();
        } catch (\Exception $exception) {
            return 0;
        }
    }

    public static function sortedHistory(array $history): array
    {
        usort($history, static function (array $a, array $b): int {
            return (int)$b['id'] <=> (int)$a['id'];
        });
        return $history;
    }

    /** Latest history must belong to the current stage, not an older visit. */
    public static function transition(array $item, array $history): ?array
    {
        $history = self::sortedHistory($history);
        $entry = $history[0] ?? null;
        if (!$entry || (string)$entry['stage'] !== (string)$item['stage']
            || (int)$entry['category'] !== (int)$item['category']) {
            return null;
        }
        return $entry;
    }

    public static function fingerprint(array $item, ?array $transition): array
    {
        return [
            'id' => (int)$item['id'], 'stage' => (string)$item['stage'],
            'category' => (int)$item['category'], 'assignee' => (int)$item['assignee'],
            'movedAt' => self::timestamp($item['movedAt'] ?? null),
            'historyId' => (int)($transition['id'] ?? 0),
        ];
    }

    public static function sameTransition(array $expected, array $item, ?array $transition): bool
    {
        return $expected === self::fingerprint($item, $transition);
    }

    /** A retry is bound to one verified history row, never an inferred visit. */
    public static function samePendingTransition(array $expected, array $item, ?array $transition): bool
    {
        return (int)($expected['historyId'] ?? 0) > 0
            && self::sameTransition($expected, $item, $transition);
    }

    public static function attemptKey(array $fingerprint): string
    {
        return hash('sha256', json_encode($fingerprint, JSON_THROW_ON_ERROR));
    }

    /**
     * Choose the oldest current visit to In work. Unknown history belongs to
     * an incumbent and sorts before a verifiable new entry, never after it.
     * Only the attempted item can be reverted; existing duplicates are untouched.
     */
    public static function winner(array $candidates): ?int
    {
        if (!$candidates) {
            return null;
        }
        usort($candidates, static function (array $a, array $b): int {
            $rank = static function (array $candidate): array {
                $entryId = (int)($candidate['entryId'] ?? 0);
                $entryTime = self::timestamp($candidate['entryTime'] ?? null);
                return [$entryId > 0 && $entryTime > 0 ? 1 : 0, $entryTime, $entryId, (int)$candidate['id']];
            };
            return $rank($a) <=> $rank($b);
        });
        return (int)$candidates[0]['id'];
    }

    /**
     * History is authoritative. PREVIOUS_STAGE_ID is a compatibility fallback;
     * the initial stage is used only for creation directly in In work.
     */
    public static function returnTarget(array $item, array $history, string $previousStageId, array $stages): ?array
    {
        $history = self::sortedHistory($history);
        $current = self::transition($item, $history);
        if (!$current) {
            return null;
        }
        foreach (array_slice($history, 1) as $entry) {
            if ($entry['stage'] === $current['stage'] && (int)$entry['category'] === (int)$current['category']) {
                continue;
            }
            $target = self::validTarget((string)$entry['stage'], (int)$entry['category'], $stages);
            // A deleted historical stage cannot be replaced by an arbitrary one.
            return $target;
        }
        $category = (int)$item['category'];
        if ($previousStageId !== '') {
            $target = self::validTarget($previousStageId, $category, $stages);
            if ($target) {
                return $target;
            }
        }
        if ((int)($current['type'] ?? 0) === 1) {
            return self::validTarget((string)($stages['initial'][$category] ?? ''), $category, $stages);
        }
        return null;
    }

    private static function validTarget(string $stage, int $category, array $stages): ?array
    {
        if ($stage === '' || !array_key_exists($stage, $stages['categoryByStage'])
            || (int)$stages['categoryByStage'][$stage] !== $category
            || in_array($stage, $stages['inWork'], true)) {
            return null;
        }
        return ['stage' => $stage, 'category' => $category];
    }
}
