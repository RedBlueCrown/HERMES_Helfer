// Azure SQL Database for the Projektakte (H01). Entra ID only (no SQL
// logins), no public network access, auditing to Log Analytics without
// statement texts (they would contain draft content), Microsoft Defender for
// SQL, and ledger digests uploaded to immutable storage.

param name string
param serverName string
param location string
param tags object

@description('Entra ID admin of the server. sid: object ID of a user or group, client ID of an application or managed identity.')
param admin {
  login: string
  sid: string
  principalType: 'Application' | 'Group' | 'User'
}

@description('Serverless General Purpose: maximum vCores.')
param maxVCores int

@description('Minutes without activity before the database pauses; -1 never pauses (no cold starts).')
param autoPauseDelay int

param workspaceId string
param endpointsSubnetId string
param sqlZoneId string

@description('Storage that receives the ledger digests; the server gets write access to it.')
param digestStorageId string
param digestBlobEndpoint string

@description('Upload ledger digests. Needs the role assignment to be effective; rerun the deployment if the first attempt fails.')
param uploadLedgerDigests bool

param enableDefender bool

@description('Protect server and database against deletion (system of record).')
param lock bool

resource server 'Microsoft.Sql/servers@2025-01-01' = {
  name: serverName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: admin.login
      sid: admin.sid
      principalType: admin.principalType
      tenantId: tenant().tenantId
    }
  }
}

resource database 'Microsoft.Sql/servers/databases@2025-01-01' = {
  parent: server
  name: 'sqldb-${name}'
  location: location
  tags: tags
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: maxVCores
  }
  properties: {
    autoPauseDelay: autoPauseDelay
    minCapacity: json('0.5')
    // Backups stay in the region, in three zones.
    requestedBackupStorageRedundancy: 'Zone'
    zoneRedundant: false
  }
}

// Storage Blob Data Contributor on the digest storage for the server's identity.
resource digestStorage 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: last(split(digestStorageId, '/'))
}

resource digestWriter 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: digestStorage
  name: guid(digestStorageId, server.id, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  properties: {
    principalId: server.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
    )
  }
}

resource ledgerDigests 'Microsoft.Sql/servers/databases/ledgerDigestUploads@2025-01-01' = if (uploadLedgerDigests) {
  parent: database
  name: 'current'
  properties: { digestStorageEndpoint: digestBlobEndpoint }
  dependsOn: [digestWriter]
}

// Server auditing to Log Analytics. Security-relevant groups only: sign-ins,
// permission, role and schema changes. Not BATCH_COMPLETED_GROUP, which would
// log statement texts with draft content (architecture §9.6).
resource masterDb 'Microsoft.Sql/servers/databases@2025-01-01' existing = {
  parent: server
  name: 'master'
}

// 2021-05-01-preview is the version with category groups; the linter only offers 2016-09-01.
#disable-next-line use-recent-api-versions
resource auditToWorkspace 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: masterDb
  name: 'audit-to-log-analytics'
  properties: {
    workspaceId: workspaceId
    logs: [{ category: 'SQLSecurityAuditEvents', enabled: true }]
  }
}

resource auditing 'Microsoft.Sql/servers/auditingSettings@2025-01-01' = {
  parent: server
  name: 'default'
  properties: {
    state: 'Enabled'
    isAzureMonitorTargetEnabled: true
    auditActionsAndGroups: [
      'SUCCESSFUL_DATABASE_AUTHENTICATION_GROUP'
      'FAILED_DATABASE_AUTHENTICATION_GROUP'
      'DATABASE_PERMISSION_CHANGE_GROUP'
      'DATABASE_PRINCIPAL_CHANGE_GROUP'
      'DATABASE_ROLE_MEMBER_CHANGE_GROUP'
      'SCHEMA_OBJECT_CHANGE_GROUP'
      'DATABASE_OBJECT_CHANGE_GROUP'
    ]
  }
  dependsOn: [auditToWorkspace]
}

resource defender 'Microsoft.Sql/servers/securityAlertPolicies@2025-01-01' = if (enableDefender) {
  parent: server
  name: 'Default'
  properties: { state: 'Enabled' }
}

resource deleteLock 'Microsoft.Authorization/locks@2020-05-01' = if (lock) {
  scope: server
  name: 'no-delete'
  properties: {
    level: 'CanNotDelete'
    notes: 'Projektakte (system of record). Remove only with a decision of the PMO and ISM.'
  }
}

module endpoint 'private-endpoint.bicep' = {
  name: 'pe-sql'
  params: {
    name: server.name
    location: location
    tags: tags
    subnetId: endpointsSubnetId
    targetId: server.id
    groupId: 'sqlServer'
    dnsZoneIds: [sqlZoneId]
  }
}

output serverName string = server.name
output serverFqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
