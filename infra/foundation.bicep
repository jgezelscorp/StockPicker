targetScope = 'resourceGroup'

@description('Environment name prefix for all resources')
param environmentName string

@description('Azure region for all resources')
param location string = resourceGroup().location

var resourceToken = uniqueString(resourceGroup().id, environmentName)

module containerAppsEnv 'modules/container-apps-env.bicep' = {
  name: 'container-apps-env'
  params: {
    environmentName: environmentName
    location: location
    resourceToken: resourceToken
  }
}

module acr 'modules/acr.bicep' = {
  name: 'acr'
  params: {
    location: location
    resourceToken: resourceToken
  }
}

output acrLoginServer string = acr.outputs.acrLoginServer
output acrName string = acr.outputs.acrName
output environmentId string = containerAppsEnv.outputs.environmentId
