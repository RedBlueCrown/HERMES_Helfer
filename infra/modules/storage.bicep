// Storage for the database ledger digests (architecture §9.1): Azure SQL
// writes a digest of its ledger here regularly, into an immutable container,
// so a change to the database can be detected from outside the database.
// No shared keys, no public blobs; only the SQL server and private endpoints get in.

param name string
param location string
param tags object

@description('Resource ID of the SQL server that uploads ledger digests.')
param sqlServerId string

@description('How long digests cannot be deleted or changed, in days.')
@minValue(1)
param retentionDays int

param endpointsSubnetId string
param blobZoneId string

@description('Protect the account against deletion.')
param lock bool

resource account 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: 'st${replace(name, '-', '')}${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_ZRS' }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    allowCrossTenantReplication: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
      resourceAccessRules: [
        {
          tenantId: tenant().tenantId
          resourceId: sqlServerId
        }
      ]
    }
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 30 }
    containerDeleteRetentionPolicy: { enabled: true, days: 30 }
  }
}

// Azure SQL writes to this container name.
resource digests 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' = {
  parent: blobs
  name: 'sqldbledgerdigests'
  properties: { publicAccess: 'None' }
}

// Time-based retention with protected appends, as the ledger needs. Left
// unlocked; lock it once the first digests arrived (docs/deployment.md, step 9).
resource digestRetention 'Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies@2025-06-01' = {
  parent: digests
  name: 'default'
  properties: {
    immutabilityPeriodSinceCreationInDays: retentionDays
    allowProtectedAppendWrites: true
  }
}

resource deleteLock 'Microsoft.Authorization/locks@2020-05-01' = if (lock) {
  scope: account
  name: 'no-delete'
  properties: {
    level: 'CanNotDelete'
    notes: 'Ledger digests of the Projektakte.'
  }
}

module endpoint 'private-endpoint.bicep' = {
  name: 'pe-blob'
  params: {
    name: '${account.name}-blob'
    location: location
    tags: tags
    subnetId: endpointsSubnetId
    targetId: account.id
    groupId: 'blob'
    dnsZoneIds: [blobZoneId]
  }
}

output id string = account.id
output name string = account.name
output blobEndpoint string = account.properties.primaryEndpoints.blob
