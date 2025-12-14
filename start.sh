#!/bin/bash

# 数字货币交易API系统一键启动脚本
# 支持 macOS 和 Linux

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查命令是否存在
check_command() {
    if ! command -v $1 &> /dev/null; then
        log_error "$1 未安装，请先安装 $1"
        return 1
    fi
    return 0
}

# 检查端口是否被占用
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        log_warning "端口 $port 已被占用"
        return 1
    fi
    return 0
}

# 显示帮助信息
show_help() {
    echo "数字货币交易API系统一键脚本"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  start     启动系统 (默认)"
    echo "  stop      停止系统"
    echo "  restart   重启系统"
    echo "  status    查看系统状态"
    echo "  logs      查看日志"
    echo "  clean     清理系统"
    echo "  dev       开发模式启动"
    echo "  test      运行测试"
    echo "  build     构建项目"
    echo "  help      显示帮助信息"
    echo ""
    echo "示例:"
    echo "  $0 start    # 启动系统"
    echo "  $0 dev      # 开发模式"
    echo "  $0 logs     # 查看日志"
}

# 检查系统依赖
check_dependencies() {
    log_info "检查系统依赖..."
    
    # 检查 Docker
    if ! check_command docker; then
        log_error "请先安装 Docker: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    # 检查 Docker Compose
    if ! check_command docker-compose; then
        log_error "请先安装 Docker Compose: https://docs.docker.com/compose/install/"
        exit 1
    fi
    
    # 检查 Node.js (开发模式需要)
    if [[ "$1" == "dev" ]] && ! check_command node; then
        log_error "开发模式需要 Node.js，请先安装: https://nodejs.org/"
        exit 1
    fi
    
    log_success "依赖检查完成"
}

# 检查环境配置
check_environment() {
    log_info "检查环境配置..."
    
    if [[ ! -f ".env" ]]; then
        if [[ -f ".env.example" ]]; then
            log_warning ".env 文件不存在，正在从 .env.example 创建..."
            cp .env.example .env
            log_warning "请编辑 .env 文件配置数据库密码等参数"
        else
            log_error ".env.example 文件不存在"
            exit 1
        fi
    fi
    
    log_success "环境配置检查完成"
}

# 启动系统
start_system() {
    log_info "启动数字货币交易API系统..."
    
    check_dependencies "docker"
    check_environment
    
    # 检查关键端口
    if ! check_port 53000; then
        log_error "API端口 53000 被占用，请先停止占用该端口的进程"
        exit 1
    fi
    
    if ! check_port 5432; then
        log_warning "PostgreSQL端口 5432 被占用，可能影响数据库启动"
    fi
    
    if ! check_port 6379; then
        log_warning "Redis端口 6379 被占用，可能影响缓存启动"
    fi
    
    # 启动 Docker 容器
    log_info "启动 Docker 容器..."
    docker-compose up -d
    
    # 等待服务启动
    log_info "等待服务启动..."
    sleep 10
    
    # 检查服务状态
    check_service_health
    
    log_success "系统启动完成！"
    log_info "API地址: http://localhost:53000"
    log_info "健康检查: http://localhost:53000/api/v1/ping"
    log_info "查看日志: $0 logs"
}

# 停止系统
stop_system() {
    log_info "停止数字货币交易API系统..."
    
    docker-compose down
    
    log_success "系统已停止"
}

# 重启系统
restart_system() {
    log_info "重启数字货币交易API系统..."
    
    stop_system
    sleep 3
    start_system
}

# 查看系统状态
show_status() {
    log_info "系统状态:"
    echo ""
    
    # Docker 容器状态
    docker-compose ps
    echo ""
    
    # 端口检查
    log_info "端口状态:"
    for port in 53000 5432 6379; do
        if check_port $port; then
            echo "  端口 $port: 空闲"
        else
            echo "  端口 $port: 占用"
        fi
    done
    echo ""
    
    # 健康检查
    log_info "服务健康检查:"
    if curl -s http://localhost:53000/api/v1/ping > /dev/null 2>&1; then
        echo "  API服务: 正常"
    else
        echo "  API服务: 异常"
    fi
}

# 查看日志
show_logs() {
    log_info "显示系统日志 (按 Ctrl+C 退出):"
    docker-compose logs -f
}

# 清理系统
clean_system() {
    log_warning "这将删除所有容器、镜像和数据，确定要继续吗? (y/N)"
    read -r response
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        log_info "清理系统..."
        
        # 停止并删除容器
        docker-compose down -v --rmi all
        
        # 删除构建缓存
        docker system prune -f
        
        log_success "系统清理完成"
    else
        log_info "取消清理操作"
    fi
}

# 开发模式
dev_mode() {
    log_info "启动开发模式..."
    
    check_dependencies "dev"
    check_environment
    
    # 只启动数据库和Redis
    log_info "启动数据库和Redis..."
    docker-compose up -d postgres redis
    
    # 等待数据库启动
    sleep 5
    
    # 安装依赖
    if [[ ! -d "node_modules" ]]; then
        log_info "安装Node.js依赖..."
        npm install
    fi
    
    # 构建项目
    log_info "构建项目..."
    npm run build
    
    # 启动开发服务器
    log_info "启动开发服务器..."
    log_success "开发模式启动完成！"
    log_info "API地址: http://localhost:53000"
    
    npm run dev
}

# 运行测试
run_tests() {
    log_info "运行测试..."
    
    check_dependencies "dev"
    
    # 启动测试数据库
    docker-compose up -d postgres redis
    sleep 5
    
    # 安装依赖
    if [[ ! -d "node_modules" ]]; then
        npm install
    fi
    
    # 运行测试
    npm test
    
    log_success "测试完成"
}

# 构建项目
build_project() {
    log_info "构建项目..."
    
    check_dependencies "dev"
    
    # 安装依赖
    if [[ ! -d "node_modules" ]]; then
        npm install
    fi
    
    # 构建
    npm run build
    
    log_success "构建完成"
}

# 检查服务健康状态
check_service_health() {
    local max_attempts=30
    local attempt=1
    
    log_info "检查服务健康状态..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s http://localhost:53000/api/v1/ping > /dev/null 2>&1; then
            log_success "API服务健康检查通过"
            return 0
        fi
        
        log_info "等待API服务启动... ($attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done
    
    log_error "API服务启动失败，请检查日志"
    docker-compose logs api
    return 1
}

# 主函数
main() {
    case "${1:-start}" in
        "start")
            start_system
            ;;
        "stop")
            stop_system
            ;;
        "restart")
            restart_system
            ;;
        "status")
            show_status
            ;;
        "logs")
            show_logs
            ;;
        "clean")
            clean_system
            ;;
        "dev")
            dev_mode
            ;;
        "test")
            run_tests
            ;;
        "build")
            build_project
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            log_error "未知选项: $1"
            show_help
            exit 1
            ;;
    esac
}

# 脚本入口
main "$@"