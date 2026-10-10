// Log Analytics and Application Insights. Both refuse key-based access, so
// only Entra ID identities with a role can write or read.

param name string
param location string
param tags object

@description('Interactive retention of logs in days (architecture §9.6).')
@minValue(30)
@maxValue(730)
param retentionInDays int

@description('Identities that send telemetry to Application Insights.')
param publisherPrincipalIds array

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: 'log-${name}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: retentionInDays
    features: { disableLocalAuth: true }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${name}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    DisableLocalAuth: true
    DisableIpMasking: false
  }
}

// Monitoring Metrics Publisher: send telemetry with Entra ID instead of the ingestion key.
resource publisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in publisherPrincipalIds: {
    scope: appInsights
    name: guid(appInsights.id, principalId, '3913510d-42f4-4e42-8a64-420c390055eb')
    properties: {
      principalId: principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId(
        'Microsoft.Authorization/roleDefinitions',
        '3913510d-42f4-4e42-8a64-420c390055eb'
      )
    }
  }
]

output workspaceId string = workspace.id
output appInsightsConnectionString string = appInsights.properties.ConnectionString
