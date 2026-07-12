# Normalization Contract

Normalization must produce structured evidence, not just a final row.

## Required Principles

- Preserve claimed values separately from normalized values.
- Keep every source row linked to its raw message.
- Keep price parsing evidence.
- Keep catalog evidence.
- Keep AI output as suggestions, not source of truth.
- Lower confidence when conflicts exist.

## Required Output Fields

```text
raw_message_id
context_block_id
candidate_id
source_line_start
source_line_end
brand_claimed
brand_normalized
reference_claimed
reference_normalized
model_claimed
model_normalized
dial_claimed
dial_normalized
condition_claimed
condition_normalized
set_status_claimed
set_status_normalized
price_raw_text
asking_price_original
currency_original
currency_evidence
currency_confidence
price_usd
fx_rate
fx_rate_date
fx_source
intent
intent_confidence
catalog_match_status
catalog_candidate_ids
text_confidence
image_confidence
final_confidence
approval_state
review_reason_codes
parser_version
normalization_version
```

