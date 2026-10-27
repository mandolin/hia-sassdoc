# SassDoc Adapter

Converts SassDoc extraction artifacts to HIA core documents.

The optional `docSourceMapContractVersion` identifies a referenced documentation source map. Older standalone calls that omit it keep the historical `0.1.0-draft` identity; the SassDoc runner passes the emitted map's actual version.
