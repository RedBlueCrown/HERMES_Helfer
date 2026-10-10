// Two identities with separate rights: the app reads and appends events; the
// migration job may change the schema and is the database's Entra ID admin.

param name string
param location string
param tags object

resource api 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-${name}-api'
  location: location
  tags: tags
}

resource migrate 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-${name}-migrate'
  location: location
  tags: tags
}

output apiId string = api.id
output apiName string = api.name
output apiClientId string = api.properties.clientId
output apiPrincipalId string = api.properties.principalId
output migrateId string = migrate.id
output migrateName string = migrate.name
output migrateClientId string = migrate.properties.clientId
output migratePrincipalId string = migrate.properties.principalId
