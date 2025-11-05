# ZAST Express

**Zero-day Application Security Testing**

Find real, exploitable vulnerabilities with zero false positives at scale. Every vulnerability is verified with working PoC and demonstrated exploits.

![ZAST Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/artifacts.png)

## 3 Steps to Run ZAST Express

1. **Install** the extension from marketplace
2. **Click** Zast to launch assessment
3. **View** results when the assessment finished

## Key Features

- 🆕 **Zero-Day Detection** - Discover unknown vulnerabilities before they're exploited
- 🔍 **Zero False Positives** - Every vulnerability verified with PoC
- ⚡ **One-Click Assessment** - No complex configuration required

Install from VS Code/Cursor Marketplace and click "Install" to get started.

## Quick Start

### Step 1: Login to ZAST Express

Click ZAST Express to open the panel. Login from the "Home" section or by clicking the profile avatar in the top-right corner.
![Install Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/login.png)

### Step 2: Select Artifacts

After successful login, you'll see the "Security Assessment" panel. Select artifacts directly from your workspace. Also, we recommend uploading source code to improve assessment depth and accuracy.
![Install Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/artifacts.png)

### Step 3: Set Up Connectivity via Cloudflared Tunnel

To establish assessment connectivity, input the port where your project is running and click "Tunnel." This will automatically install cloudflared and generate a secure access link for your project. **During the assessment, please ensure the service remains continuously accessible.**
![Install Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/tunnel.png)

### Step 4: Login Test Accounts via Embedded Browser (to test features protected by authentication)

If your target service requires authentication, use the embedded browser to log in with test accounts of different roles. Replace the URL in the embedded browser with your login URL at first and then login with the test accounts.
![Install Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/login1.png)

After logging into the test account, select the correct role and save the user session.
![Install Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/login2.png)

Click "Add Account" to configure multiple test accounts, and don't forget to choose role and save session for all test accounts.
![Install Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/login3-1.png)

### Step 5: Start Assessment

After completing all previous steps, click the "Start Security Assessment" button at the bottom to submit your task.
![Install Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/submit.png)

### Step 6: View Reports

When the assessment is complete, you'll see the task in your recent tasks list. Click "Click to view report" to access detailed results.
![Install Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/view.png)

### Task Management

The left sidebar provides two task sections for managing your security assessments:

- **Workspace Tasks**: Shows the latest 5 tasks for the Project-specific tasks (e.g., if you assess one project multiple times, the related tasks will be listed in workspace tasks)
- **Recent Tasks**: Shows the latest 10 tasks across all your projects

For all assessment reports' archive, please visit [ZAST Reports Dashboard](https://zast.ai/main/reports).

## Supported Environments

- **IDEs**: VS Code, Cursor
- **Languages**: Java
- **Frameworks**: Web applications

## Security Feature

### Proof of Concept Generation

- Working exploit code
- Remediation recommendations (To be released soon)

## Troubleshooting

### FAQ

**1. Is it necessary to upload source code?**
Zast.ai does not mandate that the actual source code be uploaded. However, the availability of source code will improve the precision of the assessment result, e.g., the line numbers for each frame of the vulnerability call flows. Not uploading source code will not affect the assessment results, but it will impact the content of the assessment report - issues cannot be pinpointed to specific source code locations, and users cannot integrate with programming tools like Cursor.

**2. How do I add more test accounts for different roles?**
After selecting a role and verifying the login status for an account (indicated by the green "Add user session" button), click "Add Account" to open a new tab. In the new page, you can proceed to log in with different test accounts, select their respective roles and complete verification, thus adding test accounts with various roles.

**3. How do I add more test accounts if they are using different login URLs？**
Once your account is verified (you'll see the 'Add user session' button turn green), click "add account" to open a new tab. Feel free to use different login URLs for additional accounts.

**4. How is vulnerability's severity determined?**
At zast.ai, we use CVSS framework version 3.1 to communicate the characteristics and severity of vulnerabilities.
A vulnerability's severity (critical, high, medium or low) is based on its CVSS score:
![Install Extension](https://raw.githubusercontent.com/zast-ai/blog/refs/heads/main/assets/img/extension/severity.png)
The score is comprised of measurements of each of the following metrics:
Attack Vector (AV)
Attack Complexity (AC)
Privileges Required (PR)
User Interaction (UI)
Scope (S)
Confidentiality (C)
Integrity (I)
Availability (A)
CVSS scoring can also have complex severity scoring. As most sources do not have a corresponding CVSS score, the CVSS score usually only reflects NVD information, which may not align with the CVSS severity.

**5. How long does the code assessment take?**
The execution time of every assessment depends on the size and complexity of the project. A typical assessment completes within a few hours.

**6. How do I assess apps that are written in other languages?**
Currently, we support Java-based web applications and services. Many other languages support is under developed. Stay tuned for more updates in the coming months.

## Support

- **Issues**: [GitHub Issues]
- **Email**: support@zast.com

## About ZAST Express

### Our Mission

Our mission is simple but powerful: **to find real, exploitable vulnerabilities with zero false positives at scale**.

We believe that security reports are cheap. Real impact requires proof. That's what ZAST stands for:

- **Zero-day Application Security Testing**
- **Zero false positives**: Every vulnerability we identify is verified with a working Proof of Concept (PoC) and a demonstrated exploit.

### What Makes Us Different

Unlike traditional security scanners that generate false positives, ZAST Express provides verified vulnerabilities with working exploits. This means you can trust every finding and focus on fixing real issues.

## License

[License Type] © 2025 ZAST Security

---

**Ready to find real vulnerabilities? Install ZAST Express today and start securing your applications with confidence.**
