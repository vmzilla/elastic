# Spring Boot + OpenTelemetry Java agent on Kubernetes (no Operator)

Test manifests that run a sample Spring Boot app (`spring-petclinic-rest`) on Kubernetes and
send OpenTelemetry traces to Elastic over OTLP using the upstream OpenTelemetry Java agent.

The agent is attached manually, without the OpenTelemetry Operator: a `busybox` init
container downloads `opentelemetry-javaagent.jar` (v2.10.0) from the OpenTelemetry GitHub
release into a shared `emptyDir` volume, and `JAVA_TOOL_OPTIONS` points the JVM at it.
The cluster must be able to reach github.com for the download. With the Operator you would
instead add the `instrumentation.opentelemetry.io/inject-java` annotation to the pod template.

## Files

| File | Purpose |
|---|---|
| `otel-apm-auth-secret.yaml` | Secret with the OTLP `Authorization` header (placeholder, fill in your key) |
| `testapp-upstream-otel.yaml` | Deployment and Service for the instrumented app (port 9966) |

The app image is `springcommunity/spring-petclinic-rest:3.4.3`
(https://hub.docker.com/r/springcommunity/spring-petclinic-rest).

## Before you apply

1. In `testapp-upstream-otel.yaml`, replace `<your-otlp-endpoint>` with your OTLP endpoint,
   for example the Elastic Cloud managed OTLP endpoint
   `https://<id>.ingest.<region>.<csp>.elastic-cloud.com:443`.
2. In `otel-apm-auth-secret.yaml`, replace `<base64_api_key>` with your API key. Never
   commit the real key. On Elastic Cloud's managed OTLP endpoint the key needs the APM
   application privilege `event:write` as well as index privileges.

## Deploy

```
kubectl apply -f otel-apm-auth-secret.yaml
kubectl apply -f testapp-upstream-otel.yaml
kubectl get pods -l app=testapp-upstream-otel
```

## Verify

```
# The agent should log its version at startup:
kubectl logs deploy/testapp-upstream-otel -c testapp-upstream-otel | grep -i javaagent

# Generate some traffic:
kubectl run curl --rm -i --restart=Never --image=curlimages/curl -- \
  curl -s http://testapp-upstream-otel:9966/petclinic/api/pettypes
```

Then check Kibana: Observability, Applications, Service inventory should list
`testapp-upstream-otel`, or look for documents in `traces-*` in Discover.

## Clean up

```
kubectl delete -f testapp-upstream-otel.yaml
kubectl delete -f otel-apm-auth-secret.yaml
```

## Reference

- https://opentelemetry.io/docs/zero-code/java/agent/
- https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases
