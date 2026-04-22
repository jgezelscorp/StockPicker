@description('Azure region')
param location string

@description('Unique resource token')
param resourceToken string

var acrName = 'acr${resourceToken}'

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
    anonymousPullEnabled: false
  }
}

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
