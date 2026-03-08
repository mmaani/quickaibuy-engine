UPDATE profitable_candidates
SET decision_status = 'APPROVED',
    reason = COALESCE(reason, '') || ' | manually approved for Listing Readiness v1'
WHERE id = '36fbe855-d7ec-4bf0-b228-c197ea13288e';
