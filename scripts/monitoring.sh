#!/bin/bash

# 监控脚本

set -e

# 配置
API_URL="http://localhost:53000"
ALERT_EMAIL="admin@example.com"
LOG_FILE="/var/log/trading-api-monitor.log"

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a $LOG_FILE
}

# 健康检查
health_check() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" $API_URL/api/v1/ping)
    
    if [ "$response" = "200" ]; then
        log "✓ API健康检查通过"
        return 0
    else
        log "✗ API健康检查失败 (HTTP $response)"
        return 1
    fi
}

# 数据库检查
db_check() {
    local result=$(docker exec trading-postgres-production pg_isready -U trading_user -d trading)
    
    if echo "$result" | grep -q "accepting connections"; then
        log "✓ 数据库连接正常"
        return 0
    else
        log "✗ 数据库连接失败: $result"
        return 1
    fi
}

# Redis检查
redis_check() {
    local result=$(docker exec trading-redis-production redis-cli ping)
    
    if [ "$result" = "PONG" ]; then
        log "✓ Redis连接正常"
        return 0
    else
        log "✗ Redis连接失败: $result"
        return 1
    fi
}

# 磁盘空间检查
disk_check() {
    local usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    if [ "$usage" -lt 80 ]; then
        log "✓ 磁盘使用率正常 ($usage%)"
        return 0
    else
        log "✗ 磁盘使用率过高 ($usage%)"
        return 1
    fi
}

# 内存检查
memory_check() {
    local usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    
    if [ "$usage" -lt 90 ]; then
        log "✓ 内存使用率正常 ($usage%)"
        return 0
    else
        log "✗ 内存使用率过高 ($usage%)"
        return 1
    fi
}

# 容器状态检查
container_check() {
    local containers=("trading-api-production" "trading-postgres-production" "trading-redis-production")
    local failed=0
    
    for container in "${containers[@]}"; do
        local status=$(docker inspect --format='{{.State.Status}}' $container 2>/dev/null || echo "not_found")
        
        if [ "$status" = "running" ]; then
            log "✓ 容器 $container 运行正常"
        else
            log "✗ 容器 $container 状态异常: $status"
            failed=1
        fi
    done
    
    return $failed
}

# 发送告警
send_alert() {
    local message="$1"
    
    # 发送邮件告警
    echo "$message" | mail -s "Trading API Alert" $ALERT_EMAIL
    
    # 发送Slack通知 (如果配置了webhook)
    if [ ! -z "$SLACK_WEBHOOK" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚨 Trading API Alert: $message\"}" \
            $SLACK_WEBHOOK
    fi
    
    log "告警已发送: $message"
}

# 主监控函数
main() {
    log "开始系统监控检查..."
    
    local failed_checks=()
    
    # 执行各项检查
    health_check || failed_checks+=("API健康检查")
    db_check || failed_checks+=("数据库检查")
    redis_check || failed_checks+=("Redis检查")
    disk_check || failed_checks+=("磁盘空间检查")
    memory_check || failed_checks+=("内存使用检查")
    container_check || failed_checks+=("容器状态检查")
    
    # 处理检查结果
    if [ ${#failed_checks[@]} -eq 0 ]; then
        log "✓ 所有监控检查通过"
    else
        local alert_message="以下检查失败: ${failed_checks[*]}"
        log "✗ $alert_message"
        send_alert "$alert_message"
        exit 1
    fi
}

# 执行监控
main "$@"