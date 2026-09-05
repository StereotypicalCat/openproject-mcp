# frozen_string_literal: true
# OpenProject MCP Companion - Test Data & API Key Seeder
# Run inside Rails environment via: bundle exec rails runner /scripts/seed-test-data.rb

require 'json'

puts "[Seeder] Starting OpenProject MCP test data initialization..."

# 1. Ensure admin user is active and has no password change requirement
admin = User.find_by(login: 'admin')
if admin.nil?
  puts "[Seeder] ERROR: Default admin user not found in database!"
  exit 1
end

admin.status = Principal.statuses[:active] if defined?(Principal) && Principal.respond_to?(:statuses)
admin.password = 'admin12345678'
admin.password_confirmation = 'admin12345678'
admin.force_password_change = false if admin.respond_to?(:force_password_change=)
admin.save(validate: false)
puts "[Seeder] Admin user configured (login: admin)."

# 2. Generate or refresh personal API token for admin
Token::API.where(user: admin).destroy_all
api_token = Token::API.create_and_return_value(admin)
puts "[Seeder] Generated new API token for admin."

# 3. Create or find dedicated MCP test project
test_project = Project.find_or_initialize_by(identifier: 'mcp-test-project')
test_project.name = 'MCP Test Project'
test_project.description = 'Dedicated test project for openproject-mcp companion server.'
test_project.public = true
test_project.workspace_type = 'project' if test_project.respond_to?(:workspace_type=)
test_project.types = Type.all if Type.any?
test_project.save!(validate: false)
puts "[Seeder] Ensured project 'MCP Test Project' (ID: #{test_project.id}, identifier: #{test_project.identifier})."

# 4. Ensure admin has project manager role in the test project
role = Role.find_by(name: 'Project admin') || Role.find_by(name: 'Manager') || Role.first
if role
  membership = Member.find_or_initialize_by(project: test_project, principal: admin)
  membership.roles = [role] unless membership.roles.include?(role)
  membership.save!(validate: false)
  puts "[Seeder] Granted admin '#{role.name}' role in '#{test_project.identifier}'."
end

# 5. Retrieve taxonomy types, statuses, and priorities
task_type = Type.find_by(name: 'Task') || Type.first
bug_type = Type.find_by(name: 'Bug') || Type.second || task_type
feature_type = Type.find_by(name: 'Feature') || Type.third || task_type

status_new = Status.find_by(name: 'New') || Status.first
status_in_progress = Status.find_by(name: 'In progress') || Status.second || status_new
status_closed = Status.find_by(name: 'Closed') || Status.last || status_new

priority_normal = IssuePriority.find_by(name: 'Normal') || IssuePriority.first
priority_high = IssuePriority.find_by(name: 'High') || IssuePriority.second || priority_normal
priority_immediate = IssuePriority.find_by(name: 'Immediate') || IssuePriority.last || priority_normal

# 6. Seed sample work packages
sample_packages = [
  {
    subject: 'Implement MCP Server Core Protocol',
    type: task_type,
    status: status_in_progress,
    priority: priority_high,
    description: 'Build stdio transport and wire up tool handlers using @modelcontextprotocol/sdk.'
  },
  {
    subject: 'Fix HAL+JSON query filter URL encoding',
    type: bug_type,
    status: status_new,
    priority: priority_immediate,
    description: 'Ensure complex filter arrays are properly stringified and encoded when fetching work packages.'
  },
  {
    subject: 'Add saved query execution tools',
    type: feature_type,
    status: status_new,
    priority: priority_normal,
    description: 'Allow LLMs to execute preconfigured OpenProject queries and inspect results.'
  },
  {
    subject: 'Initial repository bootstrap and documentation',
    type: task_type,
    status: status_closed,
    priority: priority_normal,
    description: 'Set up AGENTS.md, ARCHITECTURE.md, and initial decision records.'
  }
]

created_wps = []
sample_packages.each do |data|
  wp = WorkPackage.find_or_initialize_by(project: test_project, subject: data[:subject])
  wp.author = admin
  wp.assigned_to = admin
  wp.type = data[:type]
  wp.status = data[:status]
  wp.priority = data[:priority]
  wp.description = data[:description]
  wp.save!(validate: false)
  created_wps << { id: wp.id, subject: wp.subject, status: wp.status&.name, type: wp.type&.name }
end
puts "[Seeder] Seeded #{created_wps.size} work packages in '#{test_project.identifier}'."

# 7. Create saved query
query = Query.find_or_initialize_by(name: 'MCP Active Tasks', project: test_project)
query.user = admin
query.public = true if query.respond_to?(:public=)
query.include_subprojects = true if query.respond_to?(:include_subprojects=)
query.timestamps = [] if query.respond_to?(:timestamps=)
query.column_names = [:id, :subject, :status, :assigned_to] if query.respond_to?(:column_names=)
query.save!(validate: false)
puts "[Seeder] Seeded saved query 'MCP Active Tasks' (ID: #{query.id})."

# 8. Output summary payload for test automation
summary = {
  status: 'ok',
  baseUrl: 'http://localhost:8080',
  apiKey: api_token,
  adminUser: admin.login,
  projectId: test_project.id,
  projectIdentifier: test_project.identifier,
  queryId: query.id,
  workPackages: created_wps,
  totalProjects: Project.count,
  totalWorkPackages: WorkPackage.count
}

puts "---SEED_RESULT_START---"
puts summary.to_json
puts "---SEED_RESULT_END---"
puts "[Seeder] Completed successfully."
