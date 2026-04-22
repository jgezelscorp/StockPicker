@description('Azure region')
param location string

@description('Container Apps Environment ID')
param environmentId string

@description('ACR login server')
param acrLoginServer string

@description('User-assigned managed identity resource ID for ACR pull')
param acrIdentityId string

@description('Container image tag')
param imageTag string

@description('Internal URL of the API container app')
param apiUrl string

resource clientApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'apex-client'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${acrIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 80
        transport: 'http'
      }
      registries: [
        {
          server: acrLoginServer
          identity: acrIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'apex-client'
          image: '${acrLoginServer}/apex-client:${imageTag}'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'API_URL'
              value: '${apiUrl}'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                port: 80
                path: '/'
              }
              initialDelaySeconds: 5
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                port: 80
                path: '/'
              }
              initialDelaySeconds: 3
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output fqdn string = clientApp.properties.configuration.ingress.fqdn
output name string = clientApp.name
