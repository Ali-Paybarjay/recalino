#!/bin/sh
set -eu
# Run in a disposable Node 24 Linux container with only tools/voice and server sources mounted read-only.
# The two exact sherpa versions keep this independent smoke aligned with pnpm-lock.yaml.
npm install --prefix /smoke/apps/web --no-audit --no-fund \
  sherpa-onnx-node@1.13.8 sherpa-onnx-linux-x64@1.13.8 server-only@0.0.1
cd /smoke
exec node --conditions=react-server tools/voice/check-model-runtime.mjs
