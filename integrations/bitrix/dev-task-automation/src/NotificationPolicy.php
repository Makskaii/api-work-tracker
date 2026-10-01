<?php

namespace Evolution\DevTaskAutomation;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;

/** Pure policy: it never reads CRM, writes state, or sends a notification. */
final class NotificationPolicy
{
    public const CHECK_STAGE = 'DT1072_18:UC_5GG9S1';
    public const CLOSED_STAGES = [
        'DT1072_18:UC_6JNSDG', 'DT1072_18:UC_JP9WR1',
        'DT1072_18:SUCCESS', 'DT1072_18:FAIL',
    ];
    public const IGNORED_STAGES = [
        // A draft is not formed yet. Backlog and Hold are still actionable stages.
        'DT1072_18:UC_A9IWFS',
    ];

    public static function hours($value): ?float
    {
        if (!is_scalar($value) || is_bool($value)) {
            return null;
        }
        $number = preg_replace('/[\s\x{00A0}\x{202F}]/u', '', trim((string)$value));
        $number = str_replace(',', '.', $number);
        if (!is_numeric($number)) {
            return null;
        }
        $number = (float)$number;
        return is_finite($number) && $number >= 0 ? $number : null;
    }

    public static function date($value): ?string
    {
        if ($value instanceof DateTimeInterface) {
            return $value->format('Y-m-d');
        }
        if (is_object($value) && method_exists($value, 'format')) {
            // Bitrix\Main\Type\Date is not a native DateTimeInterface.
            return self::date($value->format('Y-m-d'));
        }
        if (!is_scalar($value) || trim((string)$value) === '') {
            return null;
        }
        foreach (['!Y-m-d', '!d.m.Y'] as $format) {
            $date = DateTimeImmutable::createFromFormat($format, trim((string)$value));
            $errors = DateTimeImmutable::getLastErrors();
            if ($date && (!$errors || ($errors['warning_count'] === 0 && $errors['error_count'] === 0))) {
                return $date->format('Y-m-d');
            }
        }
        return null;
    }

    public static function isClosed(array $task): bool
    {
        $stage = (string)($task['stage'] ?? '');
        return in_array($stage, self::CLOSED_STAGES, true)
            || in_array((string)($task['semantic'] ?? ''), ['S', 'F'], true)
            || substr($stage, -8) === ':SUCCESS'
            || substr($stage, -5) === ':FAIL';
    }

    public static function isIgnored(array $task): bool
    {
        return in_array((string)($task['stage'] ?? ''), self::IGNORED_STAGES, true);
    }

    public static function isNotificationExcluded(array $task): bool
    {
        return self::isClosed($task) || self::isIgnored($task);
    }

    public static function deadlineWindow(DateTimeImmutable $now): bool
    {
        $moscow = $now->setTimezone(new DateTimeZone('Europe/Moscow'));
        return (int)$moscow->format('N') <= 5 && $moscow->format('H:i') >= '10:00';
    }

    private static function users(array $values): array
    {
        $ids = [];
        array_walk_recursive($values, static function ($value) use (&$ids): void {
            if (is_scalar($value) && preg_match('/^(?:user_)?([0-9]+)$/', (string)$value, $matches)) {
                $id = (int)$matches[1];
                if ($id > 0) {
                    $ids[$id] = $id;
                }
            }
        });
        sort($ids, SORT_NUMERIC);
        return array_values($ids);
    }

    public static function recipients(array $task, int $headId, string $kind): array
    {
        $setters = (array)($task['setters'] ?? []);
        $assignee = (int)($task['assignee'] ?? 0);
        if ($kind === 'late_handoff') {
            return self::users([self::handoffDeveloper($task), $headId]);
        }
        if (($task['stage'] ?? '') === self::CHECK_STAGE) {
            if ($kind === 'deadline') {
                $developer = self::handoffDeveloper($task);
                return array_values(array_filter(self::users([$setters, $headId]), static function (int $id) use ($developer, $headId): bool {
                    return $id !== $developer || $id === $headId;
                }));
            }
            return self::users([$setters, $headId]);
        }
        if ($kind === 'estimate') {
            return self::users([$assignee, $headId]);
        }
        if ($kind === 'sold') {
            return self::users([$setters, $headId]);
        }
        return self::users([$assignee, $setters, $headId]);
    }

    private static function handoffDeveloper(array $task): int
    {
        // Native history RESPONSIBLE_ID is rewritten on reassignment, not a historical snapshot.
        return (int)($task['assignee'] ?? 0);
    }

    private static function checkHandoff(array $task): ?array
    {
        $handoff = $task['checkHandoff'] ?? null;
        if (!is_array($handoff) || (int)($handoff['id'] ?? 0) <= 0) {
            return null;
        }
        $date = self::date($handoff['date'] ?? null);
        if ($date === null) {
            return null;
        }
        return ['id' => (int)$handoff['id'], 'date' => $date];
    }

    /** The current visit is the latest native stage entry, never an older Check cycle. */
    public static function currentCheckVisit(array $task, array $history): ?array
    {
        if (($task['stage'] ?? '') !== self::CHECK_STAGE) {
            return null;
        }
        $latest = null;
        foreach ($history as $entry) {
            if ((int)($entry['OWNER_TYPE_ID'] ?? 0) !== 1072
                || (int)($entry['OWNER_ID'] ?? 0) !== (int)$task['id']) {
                continue;
            }
            if ($latest === null || (int)$entry['ID'] > (int)$latest['ID']) {
                $latest = $entry;
            }
        }
        if ($latest === null || (int)($latest['ID'] ?? 0) <= 0
            || !in_array((int)($latest['TYPE_ID'] ?? 0), [1, 2], true)
            || ($latest['STAGE_ID'] ?? '') !== self::CHECK_STAGE
            || (int)($latest['CATEGORY_ID'] ?? -1) !== (int)($task['category'] ?? -2)) {
            return null;
        }
        $created = $latest['CREATED_TIME'] ?? null;
        try {
            $zone = new DateTimeZone('Europe/Moscow');
            if ($created instanceof DateTimeInterface) {
                $date = DateTimeImmutable::createFromInterface($created)->setTimezone($zone);
            } elseif (is_object($created) && method_exists($created, 'getTimestamp')) {
                $timestamp = (int)$created->getTimestamp();
                if ($timestamp <= 0) {
                    return null;
                }
                $date = (new DateTimeImmutable('@' . $timestamp))->setTimezone($zone);
            } elseif (is_string($created)) {
                if (trim($created) === '') {
                    return null;
                }
                $date = new DateTimeImmutable($created, $zone);
                $errors = DateTimeImmutable::getLastErrors();
                if ($errors && ($errors['warning_count'] || $errors['error_count'])) {
                    return null;
                }
                $date = $date->setTimezone($zone);
            } else {
                return null;
            }
        } catch (\Throwable $error) {
            return null;
        }
        return ['id' => (int)$latest['ID'], 'date' => $date->format('Y-m-d')];
    }

    /**
     * tasks: id,title,stage,semantic,assignee,setters,redline,estimate,sold,actual.
     * Returns candidate digests and the rearmed state. Mark deliveries separately.
     */
    public static function evaluate(array $tasks, int $headId, array $state, DateTimeImmutable $now): array
    {
        $moscow = $now->setTimezone(new DateTimeZone('Europe/Moscow'));
        $day = $moscow->format('Y-m-d');
        $deadlineWindow = self::deadlineWindow($now);
        $state = [
            'version' => 1,
            'deadlineSentOn' => (array)($state['deadlineSentOn'] ?? []),
            'thresholds' => (array)($state['thresholds'] ?? []),
            'pendingDigests' => (array)($state['pendingDigests'] ?? []),
            'handoffAlerts' => (array)($state['handoffAlerts'] ?? []),
        ];
        $digests = [];
        $openIds = [];
        $checkingIds = [];

        foreach ($tasks as $task) {
            $id = (int)($task['id'] ?? 0);
            if ($id <= 0 || self::isNotificationExcluded($task)) {
                continue;
            }
            $openIds[(string)$id] = true;
            $redline = self::date($task['redline'] ?? null);
            $task['redline'] = $redline;
            $isChecking = ($task['stage'] ?? '') === self::CHECK_STAGE;
            $handoff = $isChecking ? self::checkHandoff($task) : null;
            $task['checkHandoff'] = $handoff;
            if ($isChecking) {
                $checkingIds[(string)$id] = true;
            }
            if ($deadlineWindow && $redline !== null && $redline <= $day) {
                $days = (int)(new DateTimeImmutable($redline, $moscow->getTimezone()))->diff($moscow->setTime(0, 0))->format('%a');
                foreach (self::recipients($task, $headId, 'deadline') as $userId) {
                    if (($state['deadlineSentOn'][(string)$userId] ?? null) === $day) {
                        continue;
                    }
                    self::append($digests, $userId, $task, 'deadline', [
                        'kind' => $isChecking
                            ? ($redline === $day ? 'review_due' : 'review_overdue')
                            : ($redline === $day ? 'due' : 'overdue'),
                        'days' => $days,
                        'handedOffOn' => $handoff['date'] ?? null,
                        'handoffTiming' => $handoff === null ? 'unknown'
                            : ($handoff['date'] <= $redline ? 'timely' : 'late'),
                    ]);
                    $digests[$userId]['deadlineDay'] = $day;
                }
            }

            // Distinguish a developer's late delivery from the time spent awaiting review.
            // This edge has its own per-visit/redline ledger, independent of today's digest.
            if ($isChecking && $handoff !== null && $redline !== null) {
                $signature = hash('sha256', implode('|', [
                    'late_handoff', $id, $handoff['id'], $handoff['date'], $redline, self::handoffDeveloper($task),
                ]));
                $previous = (array)($state['handoffAlerts'][(string)$id] ?? []);
                $state['handoffAlerts'][(string)$id] = [
                    'signature' => $signature,
                    'sentTo' => ($previous['signature'] ?? null) === $signature
                        ? (array)($previous['sentTo'] ?? []) : [],
                ];
                if ($deadlineWindow && $handoff['date'] > $redline && $handoff['date'] <= $day) {
                    foreach (self::recipients($task, $headId, 'late_handoff') as $userId) {
                        if (isset($state['handoffAlerts'][(string)$id]['sentTo'][(string)$userId])) {
                            continue;
                        }
                        self::append($digests, $userId, $task, 'late_handoff', [
                            'handedOffOn' => $handoff['date'], 'visitId' => $handoff['id'],
                            'developerId' => self::handoffDeveloper($task),
                            'action' => $userId === self::handoffDeveloper($task) ? 'write_comment' : 'request_comment',
                        ]);
                        $digests[$userId]['handoffMarks'][] = ['taskId' => $id, 'signature' => $signature];
                    }
                }
            }

            $actual = self::hours($task['actual'] ?? null) ?? 0.0;
            foreach (['estimate', 'sold'] as $metric) {
                $limit = self::hours($task[$metric] ?? null);
                $previous = (array)($state['thresholds'][(string)$id][$metric] ?? []);
                // Empty and zero estimates are not a useful finite budget.
                $exceeded = $limit !== null && $limit > 0 && $actual > $limit + 0.000001;
                $sameLimit = isset($previous['limit']) && $limit !== null
                    && abs((float)$previous['limit'] - $limit) < 0.000001;
                $sameCrossing = $exceeded && !empty($previous['exceeded']) && $sameLimit;
                $generation = (int)($previous['generation'] ?? 0) + ($exceeded && !$sameCrossing ? 1 : 0);
                $threshold = [
                    'limit' => $limit, 'exceeded' => $exceeded, 'generation' => $generation,
                    'sentTo' => $sameCrossing ? (array)($previous['sentTo'] ?? []) : [],
                ];
                $state['thresholds'][(string)$id][$metric] = $threshold;
                if (!$exceeded) {
                    continue;
                }
                $signature = self::signature($id, $metric, $threshold);
                foreach (self::recipients($task, $headId, $metric) as $userId) {
                    if (isset($threshold['sentTo'][(string)$userId])) {
                        continue;
                    }
                    self::append($digests, $userId, $task, $metric, [
                        'actual' => $actual, 'limit' => $limit, 'overrun' => $actual - $limit,
                    ]);
                    $digests[$userId]['overrunMarks'][] = [
                        'taskId' => $id, 'metric' => $metric, 'signature' => $signature,
                    ];
                }
            }
        }

        // Deleted/completed tasks cannot grow persistent state forever.
        foreach (array_keys($state['thresholds']) as $id) {
            if (!isset($openIds[(string)$id])) {
                unset($state['thresholds'][$id]);
            }
        }
        foreach (array_keys($state['handoffAlerts']) as $id) {
            if (!isset($checkingIds[(string)$id])) {
                unset($state['handoffAlerts'][$id]);
            }
        }
        foreach ($state['deadlineSentOn'] as $id => $sentDay) {
            if (!is_string($sentDay) || $sentDay < $moscow->modify('-14 days')->format('Y-m-d')) {
                unset($state['deadlineSentOn'][$id]);
            }
        }
        ksort($digests, SORT_NUMERIC);
        foreach ($digests as &$digest) {
            ksort($digest['tasks'], SORT_NUMERIC);
            $digest['tasks'] = array_values($digest['tasks']);
            // Stable on retries even when actual hours increase before a retry.
            $keyParts = [$digest['deadlineDay'] ?? '', (string)$digest['userId']];
            foreach ($digest['tasks'] as $row) {
                $keyParts[] = $row['id'] . ':stage:' . $row['stage'];
                $keyParts[] = $row['id'] . ':assignee:' . $row['assignee'];
                if (($row['checkHandoff']['id'] ?? 0) > 0) {
                    $keyParts[] = $row['id'] . ':check_visit:' . $row['checkHandoff']['id']
                        . ':' . $row['checkHandoff']['date'];
                }
                foreach ($row['reasons'] as $kind => $reason) {
                    if ($kind === 'deadline') {
                        $keyParts[] = $row['id'] . ':deadline:' . $row['redline'];
                    }
                }
            }
            foreach ($digest['overrunMarks'] as $mark) {
                $keyParts[] = $mark['signature'];
            }
            foreach ($digest['handoffMarks'] as $mark) {
                $keyParts[] = $mark['signature'];
            }
            sort($keyParts, SORT_STRING);
            $digest['key'] = hash('sha256', implode('|', $keyParts));
        }
        unset($digest);
        return ['state' => $state, 'digests' => array_values($digests)];
    }

    private static function append(array &$digests, int $userId, array $task, string $kind, array $reason): void
    {
        if (!isset($digests[$userId])) {
            $digests[$userId] = ['userId' => $userId, 'tasks' => [], 'deadlineDay' => null, 'overrunMarks' => [], 'handoffMarks' => []];
        }
        $id = (int)$task['id'];
        if (!isset($digests[$userId]['tasks'][$id])) {
            $digests[$userId]['tasks'][$id] = [
                'id' => $id, 'title' => (string)($task['title'] ?? ''),
                'stage' => (string)($task['stage'] ?? ''), 'redline' => $task['redline'] ?? null,
                'assignee' => (int)($task['assignee'] ?? 0),
                'checkHandoff' => $task['checkHandoff'] ?? null,
                'reasons' => [],
            ];
        }
        $digests[$userId]['tasks'][$id]['reasons'][$kind] = $reason;
    }

    private static function signature(int $id, string $metric, array $threshold): string
    {
        return hash('sha256', $id . '|' . $metric . '|' . sprintf('%.6F', $threshold['limit']) . '|' . $threshold['generation']);
    }

    public static function delivered(array $state, array $digest): array
    {
        $userId = (string)$digest['userId'];
        if (!empty($digest['deadlineDay'])) {
            $state['deadlineSentOn'][$userId] = $digest['deadlineDay'];
        }
        foreach ($digest['overrunMarks'] as $mark) {
            $id = (string)$mark['taskId'];
            $metric = $mark['metric'];
            if (isset($state['thresholds'][$id][$metric])
                && self::signature((int)$id, $metric, $state['thresholds'][$id][$metric]) === $mark['signature']) {
                $state['thresholds'][$id][$metric]['sentTo'][$userId] = $digest['key'];
            }
        }
        foreach ((array)($digest['handoffMarks'] ?? []) as $mark) {
            $id = (string)$mark['taskId'];
            if (($state['handoffAlerts'][$id]['signature'] ?? null) === $mark['signature']) {
                $state['handoffAlerts'][$id]['sentTo'][$userId] = $digest['key'];
            }
        }
        return $state;
    }

    /** Retain frozen page bodies only while the same reasons/recipients are still valid. */
    public static function pendingIsCurrent(array $pending, ?array $currentDigest): bool
    {
        return $currentDigest !== null
            && isset($pending['key'], $pending['userId'], $pending['partCount'], $pending['parts'])
            && $pending['key'] === $currentDigest['key']
            && (int)$pending['userId'] === (int)$currentDigest['userId']
            && (int)$pending['partCount'] > 0
            && is_array($pending['parts']) && count($pending['parts']) === (int)$pending['partCount'];
    }
}
