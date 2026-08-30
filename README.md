# zero-touch-encryption-lab
A repository trying out Kubernetes and Node.js for securing messages using a simple classifier

A small, but production-shaped secure-message platform. I will build it step by step in commits, as I evolve int the learning process.. The project should be implemented in a local **Kubernetes** cluster, I will use [kind](https://kind.sigs.k8s.io/). The messages should be stored in a database, and for this, I will use **PostgresSQL**. The services are being built using Node.js and communicate via REST.

This should cover a full cloud-style, modern backend stack based on Node.js

I might look into using tools like [spec-kit](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html). I like this tool, because it is much driven the same way as a normal process would be done:
- Define the project
- Define an architecture
- Define a list of stories
- Based on the stories we define features

I want this to be done at the latest in two days, so I'm not sure how many steps I get to, seeing that I also need to work.

## Step 1 ##
I will start, by building a POC with:
- A Node.js based service for receiving messages
- A Node.js nased service for checking if the message qualifies as to contain sensitive information

```
                 ┌───────────────┐   POST /classify    ┌──────────────┐
   client  ────► │  message-api  │ ──────────────────► │  classifier  │ 
                 │               │ ◄────────────────── │   stateless  │
                 └───────────────┘   {sensitive,...}   └──────────────┘
                          encrypt body if sensitive (AES-256-GCM)
                        
```

## Step 2 ##
This is probably where I will add the PostgresSQL and the Kubernetes implementation

# If there is time #
## Step 3 ##
Implement an Ingress
## Step 4 ##
Add some sort of AI layer to do the classification?
## Step 5 ##
In a new branch, create a SDD version
