#!/bin/bash

set -e

# 部署脚本
# 用法: ./deploy.sh <environment> <image_tag>

ENVIRONMENT=$1
IMAGE_TAG=$2

if [ -z "$ENVIRONMENT" ] || [ -z "$IMAGE_TAG" ]; then
    echo "用法: $0 <environment> <image_tag>"
    echo "示例: $0 staging ghcr.io/username/crypto-trading-api:main-abc123"
    exit 1
fi

echo "开始部署到 $ENVIRONMENT 环境..."
echo "镜像标签: $IMAGE_TAG"

# 根据环境设置配置
case $ENVIRONMENT in
    "staging")
        DEPLOY_HOST=${STAGING_HOST:-"staging.example.com"}
        DEPLOY_USER=${STAGING_USER:-"deploy"}
        COMPOSE_FILE="docker-compose.staging.yml"
        ;;
    "production")
        DEPLOY_HOST=${PRODUCTION_HOST:-"production.example.com"}
        DEPLOY_USER=${PRODUCTION_USER:-"deploy"}
        COMPOSE_FILE="docker-compose.production.yml"
        ;;
    *)
        echo "不支持的环境: $ENVIRONMENT"
        exit 1
        ;;
esac

# 创建部署目录
DEPLOY_DIR="/opt/crypto-trading-api"
BACKUP_DIR="/opt/backups/crypto-trading-api"

# 部署函数
deploy_to_server() {
    echo "连接到服务器: $DEPLOY_USER@$DEPLOY_HOST"
    
    # 创建部署脚本
    cat > deploy_remote.sh << EOF
#!/bin/bash
set -e

echo "创建部署目录..."
sudo mkdir -p $DEPLOY_DIR
sudo mkdir -p $BACKUP_DIR

echo "备份当前版本..."
if [ -d "$DEPLOY_DIR" ]; then
    sudo cp -r $DEPLOY_DIR $BACKUP_DIR/backup-\$(date +%Y%m%d-%H%M%S)
fi

echo "更新Docker镜像..."
sudo docker pull $IMAGE_TAG

echo "停止当前服务..."
cd $DEPLOY_DIR
if [ -f "$COMPOSE_FILE" ]; then
    sudo docker-compose -f $COMPOSE_FILE down || true
fi

echo "更新配置文件..."
# 这里可以添加配置文件更新逻辑

echo "启动新服务..."
export IMAGE_TAG=$IMAGE_TAG
sudo docker-compose -f $COMPOSE_FILE up -d

echo "等待服务启动..."
sleep 30

echo "健康检查..."
for i in {1..10}; do
    if curl -f http://localhost:53000/api/v1/ping > /dev/null 2>&1; then
        echo "服务启动成功!"
        break
    fi
    if [ \$i -eq 10 ]; then
        echo "服务启动失败，开始回滚..."
        sudo docker-compose -f $COMPOSE_FILE down
        # 回滚到上一个版本的逻辑
        exit 1
    fi
    echo "等待服务启动... (\$i/10)"
    sleep 10
done

echo "清理旧镜像..."
sudo docker image prune -f

echo "部署完成!"
EOF

    # 上传并执行部署脚本
    scp deploy_remote.sh $DEPLOY_USER@$DEPLOY_HOST:/tmp/
    scp $COMPOSE_FILE $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_DIR/
    
    ssh $DEPLOY_USER@$DEPLOY_HOST "chmod +x /tmp/deploy_remote.sh && /tmp/deploy_remote.sh"
    
    # 清理临时文件
    rm deploy_remote.sh
}

# 本地部署（用于开发环境）
deploy_local() {
    echo "本地部署..."
    
    # 停止当前服务
    docker-compose down || true
    
    # 拉取新镜像
    docker pull $IMAGE_TAG
    
    # 更新环境变量
    export IMAGE_TAG=$IMAGE_TAG
    
    # 启动服务
    docker-compose up -d
    
    # 健康检查
    echo "等待服务启动..."
    sleep 10
    
    for i in {1..5}; do
        if curl -f http://localhost:53000/api/v1/ping > /dev/null 2>&1; then
            echo "本地部署成功!"
            break
        fi
        if [ $i -eq 5 ]; then
            echo "本地部署失败!"
            exit 1
        fi
        sleep 5
    done
}

# 执行部署
if [ "$ENVIRONMENT" = "local" ]; then
    deploy_local
else
    deploy_to_server
fi

echo "部署到 $ENVIRONMENT 环境完成!"