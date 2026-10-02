# Optional Additions to `src/models/booking.js`

To fully utilize the ML model's capabilities in the future, consider adding the following fields to the `bookingSchema`. 
**Note:** These are strictly optional and NOT required for the current ML module to function.

```javascript
  declared_value: Joi.number().positive().optional()
    .description('Useful for calculating Expected Cost of fraud and value-aware thresholds.'),

  destination_country: Joi.string().length(2).optional()
    .description('Enables cross-border fraud typologies.'),

  card_issuer_country: Joi.string().length(2).optional()
    .description('Detects payment mismatches (e.g., IN origin shipping to IN, but card issued in NG).'),

  ip_country: Joi.string().length(2).optional()
    .description('Detects proxy/VPN usage if IP country mismatches origin country.'),

  recipient_id: Joi.string().optional()
    .description('Enables fraud ring detection on the recipient side (multiple shippers sending to one flagged recipient).'),
```
