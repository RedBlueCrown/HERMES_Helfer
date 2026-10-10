// Container registry. No admin user and no anonymous pull: the app and the
// migration job pull with their managed identities.

param name string
param location string
param tags object

@description('Identities that may pull images.')
param pullPrincipalIds array

@description('Basic is enough for a test environment.')
param sku 'Basic' | 'Standard'

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: 'cr${replace(name, '-', '')}${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  sku: { name: sku }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

// AcrPull
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in pullPrincipalIds: {
    scope: registry
    name: guid(registry.id, principalId, '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    properties: {
      principalId: principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId(
        'Microsoft.Authorization/roleDefinitions',
        '7f951dda-4ed3-4680-a7ca-43fe172d538d'
      )
    }
  }
]

output name string = registry.name
output loginServer string = registry.properties.loginServer
