// Microsoft Foundry (AI Services) with Azure OpenAI deployments in the EU
// (architecture §4.3). No keys (Entra ID only), no public network access,
// no outbound calls, pinned model versions, default content filter with
// Prompt Shields.

param name string
param location string
param tags object

@export()
type modelDeployment = {
  @description('Deployment name, used by the app.')
  name: string
  @description('Model name, for example gpt-5.1. Check: az cognitiveservices model list -l <region>')
  model: string
  @description('Model version; pinned, upgraded only by a release that passed the evaluation set.')
  version: string
  @description('Standard: processing in this one region (recommended). DataZoneStandard: EU data zone.')
  sku: 'Standard' | 'DataZoneStandard'
  @description('Quota in thousands of tokens per minute.')
  capacity: int
}

param draftModel modelDeployment
param chatModel modelDeployment

@description('Identities that call the models (role Cognitive Services OpenAI User).')
param userPrincipalIds array

param workspaceId string
param endpointsSubnetId string
param aiZoneIds array

var subdomain = 'ais-${name}-${uniqueString(resourceGroup().id)}'
var deployments = draftModel.name == chatModel.name ? [draftModel] : [draftModel, chatModel]

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: subdomain
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: subdomain
    disableLocalAuth: true
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny' }
    restrictOutboundNetworkAccess: true
    allowedFqdnList: []
  }
}

@batchSize(1)
resource modelDeployments 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = [
  for d in deployments: {
    parent: account
    name: d.name
    sku: {
      name: d.sku
      capacity: d.capacity
    }
    properties: {
      model: {
        format: 'OpenAI'
        name: d.model
        version: d.version
      }
      versionUpgradeOption: 'NoAutoUpgrade'
      raiPolicyName: 'Microsoft.DefaultV2'
    }
  }
]

// Cognitive Services OpenAI User
resource users 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in userPrincipalIds: {
    scope: account
    name: guid(account.id, principalId, '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    properties: {
      principalId: principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId(
        'Microsoft.Authorization/roleDefinitions',
        '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
      )
    }
  }
]

// 2021-05-01-preview is the version with category groups; the linter only offers 2016-09-01.
#disable-next-line use-recent-api-versions
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: account
  name: 'to-log-analytics'
  properties: {
    workspaceId: workspaceId
    logs: [{ categoryGroup: 'audit', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

module endpoint 'private-endpoint.bicep' = {
  name: 'pe-ai'
  params: {
    name: account.name
    location: location
    tags: tags
    subnetId: endpointsSubnetId
    targetId: account.id
    groupId: 'account'
    dnsZoneIds: aiZoneIds
  }
}

output endpoint string = 'https://${subdomain}.openai.azure.com'
output draftDeployment string = draftModel.name
output chatDeployment string = chatModel.name
