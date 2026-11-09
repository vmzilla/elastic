# Spring Boot + EDOT Java agent on Kubernetes (no Operator)

Test manifests that run a sample Spring Boot app on Kubernetes and send OpenTelemetry
traces to Elastic using the Elastic Distribution of OpenTelemetry (EDOT) Java agent.

The agent is attached manually: an init container copies the agent jar from the EDOT
Java image into a shared `emptyDir` volume, and `JAVA_TOOL_OPTIONS` points the JVM at it.
This works without the OpenTelemetry Operator. With the Operator you would instead
add the `instrumentation.opentelemetry.io/inject-java` annotation to the pod template.

## Files

| File | Purpose |
|---|---|
| `otel-apm-auth-secret.yaml` | Secret with the OTLP `Authorization` header (placeholder, fill in your key) |
| `testapp-instrument.yaml` | Deployment and Service for the instrumented app |

The app image is `springio/gs-spring-boot-docker` (Spring Boot 2.2.1 hello-world, Java 8).
The agent image is `docker.elastic.co/observability/elastic-otel-javaagent:1.14.0`.

## Before you apply

1. In `testapp-instrument.yaml`, replace `<your-otlp-endpoint>` with your OTLP endpoint,
   for example the Elastic Cloud managed OTLP endpoint
   `https://<id>.ingest.<region>.<csp>.elastic-cloud.com:443`.
2. In `otel-apm-auth-secret.yaml`, replace `<base64_api_key>` with your API key. Never
   commit the real key. On Elastic Cloud's managed OTLP endpoint the key needs the APM
   application privilege `event:write` as well as index privileges.

## Deploy

```
kubectl apply -f otel-apm-auth-secret.yaml
kubectl apply -f testapp-instrument.yaml
kubectl get pods -l app=testapp-instrument
```

## Verify

```
# The agent should log its version at startup:
kubectl logs deploy/testapp-instrument -c testapp-instrument | grep -i javaagent

# Generate some traffic:
kubectl run curl --rm -i --restart=Never --image=curlimages/curl -- \
  curl -s http://testapp-instrument:8080/
```

Then check Kibana: Observability, Applications, Service inventory should list
`testapp-instrument`, or look for documents in `traces-*` in Discover.

## Clean up

```
kubectl delete -f testapp-instrument.yaml
kubectl delete -f otel-apm-auth-secret.yaml
```

## Reference

- https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/java/setup/k8s
- https://www.elastic.co/docs/solutions/observability/get-started/opentelemetry/use-cases/kubernetes/instrumenting-applications
