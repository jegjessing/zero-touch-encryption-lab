// k6 load test for the classifier. Ramps virtual users up and holds, hitting
// POST /classify with a sensitive Danish message so the regex + weighting path
// does real CPU work — which is what drives the HorizontalPodAutoscaler.
//
// This file is the source of truth; it is embedded verbatim into the ConfigMap
// in k6-load.yaml (keep the two in sync). Run it with `make load-test`.
import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "15s", target: 50 }, // ramp up to 50 virtual users
    { duration: "75s", target: 50 }, // hold — long enough for the HPA to react
    { duration: "10s", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% errors or the test fails
  },
};

// Talk to the Service by its in-cluster DNS name (see docs/LEARNING.md §2).
const URL = "http://classifier.zerotouch-lab.svc.cluster.local:8081/classify";
const PARAMS = { headers: { "Content-Type": "application/json" } };
const BODY = JSON.stringify({
  text: "Hej, din klient har CPR 010203-1234 og IBAN DK5000400440116243, ring 20304050.",
});

export default function () {
  const res = http.post(URL, BODY, PARAMS);
  check(res, {
    "status is 200": (r) => r.status === 200,
    // Guard on status first: a request that errored under load has a null body,
    // and calling r.json() on that throws. Short-circuit avoids the noise.
    "flagged sensitive": (r) => r.status === 200 && r.json("sensitive") === true,
  });
}
