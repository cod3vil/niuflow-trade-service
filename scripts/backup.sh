#!/bin/bash

# 数据库备份脚本

set -e

# 配置
DB_HOST="postgres"
DB_NAME="trading"
DB_USER="trading_user"
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/trading_backup_$DATE.sql"
RETENTION_DAYS=7

echo "开始数据库备份: $DATE"

# 创建备份目录
mkdir -p $BACKUP_DIR

# 执行备份
pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME > $BACKUP_FILE

# 压缩备份文件
gzip $BACKUP_FILE

echo "备份完成: ${BACKUP_FILE}.gz"

# 清理旧备份文件
echo "清理 $RETENTION_DAYS 天前的备份文件..."
find $BACKUP_DIR -name "trading_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

# 备份到云存储 (可选)
if [ ! -z "$AWS_S3_BUCKET" ]; then
    echo "上传备份到 S3..."
    aws s3 cp ${BACKUP_FILE}.gz s3://$AWS_S3_BUCKET/backups/
fi

echo "备份任务完成"