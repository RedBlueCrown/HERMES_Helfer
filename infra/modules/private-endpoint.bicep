// Private endpoint for one resource, registered in its private DNS zones.

param name string
param location string
param tags object
param subnetId string
param targetId string

@description('Sub-resource, for example sqlServer, blob or account.')
param groupId string

param dnsZoneIds array

resource endpoint 'Microsoft.Network/privateEndpoints@2025-05-01' = {
  name: 'pe-${name}'
  location: location
  tags: tags
  properties: {
    subnet: { id: subnetId }
    privateLinkServiceConnections: [
      {
        name: 'pe-${name}'
        properties: {
          privateLinkServiceId: targetId
          groupIds: [groupId]
        }
      }
    ]
  }
}

resource dns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2025-05-01' = {
  parent: endpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      for (zoneId, i) in dnsZoneIds: {
        name: 'zone-${i}'
        properties: { privateDnsZoneId: zoneId }
      }
    ]
  }
}
