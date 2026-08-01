# Bundled URL classifier

Int8 ONNX export of
[`CrabInHoney/urlbert-tiny-v4-phishing-classifier`](https://huggingface.co/CrabInHoney/urlbert-tiny-v4-phishing-classifier)
(Apache-2.0, 3.69M parameters, BERT-tiny architecture trained on URL strings).
Loaded offline by `lib/server/ml/local-classifier.ts` via
`@huggingface/transformers` — no API key, no network access at inference time.

## Labels

`config.json` ships generic ids; the documented mapping is:

| id      | class    |
| ------- | -------- |
| LABEL_0 | benign   |
| LABEL_1 | phishing |

## Provenance

Converted from the upstream fp32 safetensors weights (not a third-party
re-upload):

```bash
pip install "optimum[exporters]" optimum-onnx onnxruntime
optimum-cli export onnx \
  --model CrabInHoney/urlbert-tiny-v4-phishing-classifier \
  --task text-classification out/
python -c "from onnxruntime.quantization import quantize_dynamic, QuantType; \
  quantize_dynamic('out/model.onnx', 'out/model_quantized.onnx', weight_type=QuantType.QUInt8)"
```

Quantization was verified against the PyTorch original on a spot-check set
(max softmax deviation 0.0092, no label flips). Upstream reports 0.9907
accuracy / 0.9900 F1 on its held-out split; treat those as in-distribution
numbers — the classifier is one dampened ensemble member, not an oracle.

## Checksums (sha256)

```
50c47b541a04390c4c03a876da9c9a9dcca36f1a076c4599e948caeb78cf5586  onnx/model_quantized.onnx
89a6203b3def4d83019141cff251f761cb8c49970ee4c5421f906bce7fd33504  tokenizer.json
7970e44e51a7afb6ad81d79edb640d4d7e7ca6ddaa964b5c64338e9a56b0c145  config.json
```
