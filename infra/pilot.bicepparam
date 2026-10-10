// Parameters of the pilot environment. Values in <…> come from earlier steps
// in docs/deployment.md; the model choice is a proposal until F2 to F4 are answered.
using './main.bicep'

param environmentName = 'pilot'

// Step 2 leaves image empty; step 5 sets it, together with the Entra ID values from step 3.
param image = ''
param entraApiClientId = ''
param entraWebClientId = ''
param entraApiScope = ''

// Company egress addresses, for example ['203.0.113.0/24']. Empty: reachable from anywhere (sign-in still required).
param allowedIpRanges = []

// One deployment for drafts, Kritiker and chat. Check before deploying that the
// model is offered as Standard (regional) in the region:
//   az cognitiveservices model list -l swedencentral -o table
param draftModel = {
  name: 'hh-gpt'
  model: 'gpt-5.1'
  version: '2025-11-13'
  sku: 'Standard'
  capacity: 50
}
param chatModel = {
  name: 'hh-gpt'
  model: 'gpt-5.1'
  version: '2025-11-13'
  sku: 'Standard'
  capacity: 50
}
param aiRegionLabel = 'Sweden Central (regional)'
