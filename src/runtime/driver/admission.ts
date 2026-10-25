// The resource admission acknowledgement this driver returns in GetCapabilities (PRD-GW-03). The gateway parses it and
// compares it with its own effective policy, so it must equal what the pinned OpenShell build emits.
//
// The value was captured from the OpenShell 0.1.5 build, not written by hand. It is the output of
// DriverAdmissionConfig::default().acknowledgement() (crates/openshell-core/src/resource_admission.rs) at the v0.1.5
// tag, which is the same tree as the vendored protos' revision c4688aa. The capture ran that function in a throwaway
// test and printed the result. To change it, re-capture from the pinned build and update the test that pins it; do
// not edit it by hand.
export const DRIVER_ADMISSION_ACKNOWLEDGEMENT =
  'v1:{"allow_driver_config":false,"resource_admission":{"enabled":true,"required_labels":{"openshell.ai/sandbox-attachable":"true","openshell.ai/sandbox-attachable-workspace":"${workspace}"}}}';
