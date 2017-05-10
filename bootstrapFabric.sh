#!/bin/bash

# Install prerequisite packages for a RHEL Hyperledger Fabric bootstrap
install_rhel_prereqs() {
  echo -e "\nInstalling RHEL prerequisite packages\n"
  yum -y -q install git gcc gcc-c++ wget tar device-mapper libtool-ltdl-devel policycoreutils-python.ppc64le python2 python2-pip
  if [ $? != 0 ]; then
    echo -e "\nERROR: Unable to install pre-requisite packages.\n"
    exit 1
  fi
  install_pip
}

# Install prerequisite packages for a SLES Hyperledger Fabric bootstrap
install_sles_prereqs() {
  echo -e "\nInstalling SLES prerequisite packages\n"
  zypper --non-interactive in git-core gcc make gcc-c++ patterns-sles-apparmor libtool
  if [ $? != 0 ]; then
    echo -e "\nERROR: Unable to install pre-requisite packages.\n"
    exit 1
  fi
  install_pip
}

# Install prerequisite packages for an Unbuntu Hyperledger Fabric bootstrap
install_ubuntu_prereqs() {
  echo -e "\n*** install_ubuntu_prereqs ***\n"
  PACKAGES="build-essential libtool git python-pip"
  apt -y install $PACKAGES
  echo -e "*** DONE ***\n"
}

# Determine flavor of Linux OS
get_linux_flavor() {
  OS_FLAVOR=`cat /etc/os-release | grep ^NAME | sed -r 's/.*"(.*)"/\1/'`

  if grep -iq 'red' <<< $OS_FLAVOR; then
    OS_FLAVOR="rhel"
  elif grep -iq 'sles' <<< $OS_FLAVOR; then
    OS_FLAVOR="sles"
  elif grep -iq 'ubuntu' <<< $OS_FLAVOR; then
    OS_FLAVOR="ubuntu"
  else
    echo -e "\nERROR: Unsupported Linux Operating System.\n"
    exit 1
  fi
}

# Build and install the Docker Daemon
install_docker() {
  echo -e "\n*** install_docker ***\n"

  # Setup Docker for RHEL or SLES
  if [ $1 == "rhel" ]; then
  # Install Docker
    cd /tmp
    wget -q http://ftp.unicamp.br/pub/ppc64el/rhel/7_1/docker-ppc64el/docker-1.12.6-0.ael7b.ppc64le.rpm
    wget -q http://ftp.unicamp.br/pub/ppc64el/rhel/7_1/docker-ppc64el/docker-selinux-1.12.6-0.ael7b.noarch.rpm
    # Setup Docker Daemon service
    if [ ! -d /etc/docker ]; then
      mkdir -p /etc/docker
    fi

    # Create environment file for the Docker service
    touch /etc/docker/docker.conf
    chmod 664 /etc/docker/docker.conf
    echo 'DOCKER_OPTS="-H tcp://0.0.0.0:2375 -H unix:///var/run/docker.sock -s overlay"' >> /etc/docker/docker.conf
    touch /etc/systemd/system/docker.service
    chmod 664 /etc/systemd/system/docker.service

    # Create Docker service file
    cat > /etc/systemd/system/docker.service <<EOF
[Unit]
Description=Docker Application Container Engine
Documentation=https://docs.docker.com

[Service]
Type=notify
ExecStart=/usr/bin/docker daemon \$DOCKER_OPTS
EnvironmentFile=-/etc/docker/docker.conf

[Install]
WantedBy=default.target
EOF
    # Start Docker Daemon
    systemctl daemon-reload
    systemctl enable docker.service
    systemctl start docker.service
  elif [ $1 == "sles" ]; then
    zypper --non-interactive in docker
    systemctl stop docker.service
    sed -i '/^DOCKER_OPTS/ s/\"$/ \-H tcp\:\/\/0\.0\.0\.0\:2375\"/' /etc/sysconfig/docker
    systemctl enable docker.service
    systemctl start docker.service
  else      # Setup Docker for Ubuntu
    apt-get -y install docker.io
    systemctl stop docker.service
    sed -i "\$aDOCKER_OPTS=\"-H tcp://0.0.0.0:2375 -H unix:///var/run/docker.sock\"" /etc/default/docker
    systemctl enable docker.service
    systemctl start docker.service
  fi

  echo -e "*** DONE ***\n"
}

# Install Nodejs
install_nodejs() {
  echo -e "\n*** install_nodejs ***\n"
  cd /tmp
  wget -q https://nodejs.org/dist/v6.9.5/node-v6.9.5-linux-ppc64le.tar.gz
  cd /usr/local && tar --strip-components 1 -xzf /tmp/node-v6.9.5-linux-ppc64le.tar.gz
  npm install gulp -g
  echo -e "*** DONE ***\n"
}

# Install the Golang compiler for the s390x platform
install_golang() {
  echo -e "\n*** install_golang ***\n"
  export GOROOT="/opt/go"
  cd /tmp
  wget --quiet --no-check-certificate https://storage.googleapis.com/golang/go1.7.5.linux-ppc64le.tar.gz
  tar -C /usr/local -xzf go1.7.5.linux-ppc64le.tar.gz
  rm -f /etc/profile.d/goroot.sh || :
  update-alternatives --install /usr/bin/go go /usr/local/go/bin/go 10
  update-alternatives --install /usr/bin/gofmt gofmt /usr/local/go/bin/gofmt 10
  echo -e "*** DONE ***\n"
}

install_docker_images() {
  echo -e "\n*** install_docker_images ***\n"
  sh download-dockerimages.sh
  echo -e "*** DONE ***\n"
}

install_docker_compose() {
  echo -e "\n*** install_docker_compose ***\n"
  pip install -U pip
  pip install docker-compose==1.11
  echo -e "*** DONE ***\n"
}

install_pip() {
  cd /tmp
  curl -s "https://bootstrap.pypa.io/get-pip.py" -o "get-pip.py"
  python get-pip.py > /dev/null 2>&1
}

cleanup() {
  rm -f /tmp/go1.7.5.linux-ppc64le.tar.gz
  rm -f /tmp/node-v6.9.5-linux-ppc64le.tar.gz
  rm -rf /tmp/docker*
}

get_linux_flavor
install_${OS_FLAVOR}_prereqs
install_golang
install_nodejs
install_docker $OS_FLAVOR
install_docker_images
install_docker_compose
cleanup

echo "Fabric bootstrapping complete."
exit 0
