# Elastic Stack on GKE — ECK Manifests

Deploys Elasticsearch, Kibana, and Fleet Server on a GKE cluster using the [Elastic Cloud on Kubernetes (ECK)](https://www.elastic.co/guide/en/cloud-on-k8s/current/index.html) operator.

## Stack

| Component     | Version | CRD API                           |
|--------------|---------|-----------------------------------|
| Elasticsearch | 9.5.1   | `elasticsearch.k8s.elastic.co/v1` |
| Kibana        | 9.5.1   | `kibana.k8s.elastic.co/v1`        |
| Fleet Server  | 9.5.1   | `agent.k8s.elastic.co/v1alpha1`   |

All components are deployed in the `elastic-system` namespace.

## Prerequisites

- A running GKE cluster with `kubectl` configured
- ECK CRDs and Operator installed (see below)

### 1. Install ECK CRDs

```bash
kubectl create -f https://download.elastic.co/downloads/eck/3.4.1/crds.yaml
```

### 2. Install ECK Operator

```bash
kubectl create -f https://download.elastic.co/downloads/eck/3.4.1/operator.yaml
```

Wait for the operator pod to be ready:

```bash
kubectl rollout status statefulset elastic-operator -n elastic-system
```

## Deploy the Stack

> **Important:** The three steps below must be applied in order with health checks between them.
> Kibana must be fully green and Fleet initialized before Fleet Server is deployed.
> Do **not** use `kubectl apply -f .` — it skips the required ordering.

### Step 1 — Deploy Elasticsearch

```bash
kubectl apply -f 01-elasticsearch.yaml
```

Wait until health is `green` or `yellow` (yellow is normal for a single-node cluster):

```bash
kubectl get elasticsearch -n elastic-system -w
# HEALTH   NODES   VERSION   PHASE
# yellow   1       9.5.1     Ready   ← proceed when you see this
```

### Step 2 — Deploy Kibana

```bash
kubectl apply -f 02-kibana.yaml
```

Wait until Kibana is `green`:

```bash
kubectl get kibana -n elastic-system -w
# HEALTH   NODES   VERSION
# green    1       9.5.1   ← proceed when you see this
```

### Step 3 — Create the Fleet Server policy in Kibana

**Kibana 9.x / ECK 3.x does not auto-create the default Fleet Server agent policy.** ECK requires a policy with `is_default_fleet_server: true` to exist before it can deploy Fleet Server. Create it now:

```bash
ES_PASS=$(kubectl get secret elasticsearch-es-elastic-user -n elastic-system \
  -o go-template='{{.data.elastic | base64decode}}')

KIBANA_POD=$(kubectl get pod -n elastic-system \
  -l kibana.k8s.elastic.co/name=kibana \
  -o jsonpath='{.items[0].metadata.name}')

POLICY_ID=$(kubectl exec -n elastic-system $KIBANA_POD -- \
  curl -sk -X POST \
  -u "elastic:$ES_PASS" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d '{"name":"Fleet Server Policy","description":"Fleet Server policy managed by ECK","namespace":"default","is_default_fleet_server":true}' \
  "https://localhost:5601/api/fleet/agent_policies" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['item']['id'])")

echo "Fleet Server Policy ID: $POLICY_ID"
```

Copy the printed policy ID, then update `policyID` in `03-fleet-server.yaml`:

```bash
sed -i '' "s/policyID: .*/policyID: $POLICY_ID/" 03-fleet-server.yaml
```

### Step 4 — Deploy Fleet Server

```bash
kubectl apply -f 03-fleet-server.yaml
```

Wait until Fleet Server is `green`:

```bash
kubectl get agent -n elastic-system -w
# HEALTH   AVAILABLE   EXPECTED   VERSION
# green    1           1          9.5.1   ← done
```

## Access Kibana

Kibana is exposed via a GCP external LoadBalancer on port 5601. Get the external IP:

```bash
kubectl get svc kibana-kb-http -n elastic-system
```

Retrieve the auto-generated `elastic` user password:

```bash
kubectl get secret elasticsearch-es-elastic-user -n elastic-system \
  -o go-template='{{.data.elastic | base64decode}}' && echo
```

Open `https://<EXTERNAL_IP>:5601` and log in as `elastic`.

> The TLS certificate is self-signed by ECK. Accept the browser security warning or fetch the CA:
> ```bash
> kubectl get secret elasticsearch-es-http-certs-public -n elastic-system \
>   -o go-template='{{index .data "tls.crt" | base64decode}}'
> ```

## Access Fleet Server

Fleet Server is exposed via a GCP external LoadBalancer on port 8220:

```bash
kubectl get svc fleet-server-agent-http -n elastic-system
```

Use `https://<EXTERNAL_IP>:8220` as the Fleet Server URL when enrolling Elastic Agents.

## Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │            elastic-system namespace            │
                  │                                              │
  Browser ───────►│  Kibana (LoadBalancer :5601)                 │
                  │      │ elasticsearchRef                      │
                  │      ▼                                       │
  Agents ────────►│  Fleet Server (LoadBalancer :8220)          │
                  │      │ elasticsearchRef + kibanaRef          │
                  │      ▼                                       │
                  │  Elasticsearch (ClusterIP, 1 node)           │
                  │      │ PVC (10 GiB)                          │
                  └──────────────────────────────────────────────┘
```

## Cleanup

```bash
kubectl delete -f .
```

> Deleting the Elasticsearch CR does **not** remove PersistentVolumeClaims. Delete them manually to free GCP disk:
>
> ```bash
> kubectl delete pvc -l elasticsearch.k8s.elastic.co/cluster-name=elasticsearch -n elastic-system
> ```
