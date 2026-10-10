// A test environment: the same security set-up as the pilot, but smaller and
// removable (no delete locks). Used by scripts/deploy-azure.sh.
using './main.bicep'

param environmentName = 'test'

// Set by scripts/deploy-azure.sh.
param image = ''
param entraApiClientId = ''
param entraWebClientId = ''
param entraApiScope = ''

param allowedIpRanges = []

// Smaller and cheaper than the pilot.
param sqlTier = 's0'
param registrySku = 'Basic'
param apiSize = {
  cpu: '0.5'
  memory: '1Gi'
}
param enableDefenderForSql = false
param lockDataResources = false
param ledgerDigestRetentionDays = 7
param logRetentionDays = 30

// One deployment for drafts, Kritiker and chat. The deploy script checks that the
// model is offered as Standard (regional) in the region before it starts.
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
