#!/bin/bash

UP_DOWN=$1
CH_NAME=$2

COMPOSE_FILE=docker-compose.yaml

function printHelp () {
  echo "Usage: ./network_setup <up|down> [ channel_name ]"
}

function validateArgs () {
  if [ -z "${UP_DOWN}" ]; then
    echo "Option up / down / restart not mentioned"
    printHelp
    exit 1
  fi
  if [ -z "${CH_NAME}" ]; then
    echo "setting to default channel 'mychannel'"
    CH_NAME=mychannel
        fi
}

function clearContainers () {
        CONTAINER_IDS=$(docker ps -aq)
        if [ -z "$CONTAINER_IDS" -o "$CONTAINER_IDS" = " " ]; then
                echo "---- No containers available for deletion ----"
        else
                docker rm -f $CONTAINER_IDS
        fi
}

function removeUnwantedImages() {
        DOCKER_IMAGE_IDS=$(docker images | grep "dev\|none\|test-vp\|peer[0-9]-" | awk '{print $3}')
        if [ -z "$DOCKER_IMAGE_IDS" -o "$DOCKER_IMAGE_IDS" = " " ]; then
                echo "---- No images available for deletion ----"
        else
                docker rmi -f $DOCKER_IMAGE_IDS
        fi
}

function marblesSetup () {
  cd marbles
  npm install

  # Update the marbles app credential files with the current channel name
  ID='"channel_id": "'${CH_NAME}'",'
  sed -i '35d' config/blockchain_creds1.json
  sed -i '35d' config/blockchain_creds2.json
  sed -i '35i\            '"${ID}" config/blockchain_creds1.json
  sed -i '35i\            '"${ID}" config/blockchain_creds2.json
}

function marblesUIStart () {
  echo -e "\nWaiting for marbles chaincode to initialize..."
  sleep 30
  echo "Starting the marbles UI application..."
  cd marbles
  gulp marbles1 > /dev/null 2>&1 &
  gulp marbles2 > /dev/null 2>&1 &
  echo ""
  echo "Open two browser sessions:"
  echo "1. <marbles-host-ip>:3001"
  echo "2. <marbles-host-ip>:3002"
  echo ""
}

function marblesCleanup () {
  # Clear out marbles app hash
  HASH='"last_startup_hash": ""'
  sed -i '12d' marbles/config/marbles1.json
  sed -i '12d' marbles/config/marbles2.json
  sed -i '12i\    '"${HASH}" marbles/config/marbles1.json
  sed -i '12i\    '"${HASH}" marbles/config/marbles2.json
  pkill -f 'node app.js'
}

function networkUp () {
  CURRENT_DIR=$PWD
  source generateCfgTrx.sh $CH_NAME
  marblesSetup
  cd $CURRENT_DIR

  CHANNEL_NAME=$CH_NAME docker-compose -f $COMPOSE_FILE up -d 2>&1
  if [ $? -ne 0 ]; then
    echo "ERROR !!!! Unable to pull the images "
    exit 1
  fi
  marblesUIStart
}

function networkDown () {
  marblesCleanup
  docker-compose -f $COMPOSE_FILE down
  #Cleanup the chaincode containers
  clearContainers
  #Cleanup images
  removeUnwantedImages
}

validateArgs

#Create the network using docker compose
if [ "${UP_DOWN}" == "up" ]; then
  networkUp
elif [ "${UP_DOWN}" == "down" ]; then ## Clear the network
  networkDown
elif [ "${UP_DOWN}" == "restart" ]; then ## Restart the network
  networkDown
  networkUp
else
  printHelp
  exit 1
fi
