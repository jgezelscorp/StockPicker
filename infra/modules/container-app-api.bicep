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

@description('Finnhub API key')
@secure()
param finnhubApiKey string

@description('OpenAI API key')
@secure()
param openaiApiKey string

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'apex-api'
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
        external: false
        targetPort: 3001
        transport: 'http'
      }
      registries: [
        {
          server: acrLoginServer
          identity: acrIdentityId
        }
      ]
      secrets: [
        {
          name: 'finnhub-api-key'
          value: finnhubApiKey
        }
        {
          name: 'openai-api-key'
          value: openaiApiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'apex-api'
          image: '${acrLoginServer}/apex-api:${imageTag}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'PORT'
              value: '3001'
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'DB_PATH'
              value: '/data/apex.db'
            }
            {
              name: 'FINNHUB_API_KEY'
              secretRef: 'finnhub-api-key'
            }
            {
              name: 'OPENAI_API_KEY'
              secretRef: 'openai-api-key'
            }
          ]
          volumeMounts: [
            {
              volumeName: 'sqlite-data'
              mountPath: '/data'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                port: 3001
                path: '/api/status'
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                port: 3001
                path: '/api/status'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'sqlite-data'
          storageType: 'EmptyDir'
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output fqdn string = apiApp.properties.configuration.ingress.fqdn
output name string = apiApp.name
