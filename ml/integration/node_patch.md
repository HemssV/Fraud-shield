# Node.js Integration Patch

## `src/services/fraudScreeningService.js` (or wherever `scoreShipment` is called)

Since the ML engine has moved from a synchronous mock to a remote microservice, the call must be `await`ed.

### Before:
```javascript
const mlResult = scoreShipment(features);
```

### After:
```javascript
const mlResult = await scoreShipment(features, booking.shipment_id);
```

*Note: Verify that the parent function (`screenShipment` or equivalent) is already `async`. Since it's doing DB calls, it almost certainly is.*
