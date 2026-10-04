# TLS test fixtures (test only)

Throwaway material for the connector-transport integration tests. Nothing here is a
secret and none of it is used outside tests:

- `ca.crt` - a test CA created for this purpose (its private key was discarded).
- `pin.crt` / `pin.key` - server certificate for `pin.example.test`.
- `other.crt` / `other.key` - server certificate for `other.example.test`.

All are valid for 100 years so the tests never expire. The hostnames are never resolved by
real DNS; the tests inject a resolver. Do not trust `ca.crt` anywhere outside the tests.
