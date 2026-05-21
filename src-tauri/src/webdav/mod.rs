use reqwest::{Client, Method, Response, header};
use serde::{Deserialize, Serialize};
use log::{info, error, debug};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavConfig {
    pub url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavError {
    pub message: String,
    pub status_code: Option<u16>,
}

impl std::fmt::Display for WebDavError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for WebDavError {}

pub struct WebDavClient {
    client: Client,
    config: WebDavConfig,
}

impl WebDavClient {
    pub fn new(config: WebDavConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .danger_accept_invalid_certs(false)
            .build()
            .expect("Failed to create HTTP client");

        Self { client, config }
    }

    fn build_auth_header(&self) -> String {
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", self.config.username, self.config.password),
        );
        format!("Basic {}", encoded)
    }

    async fn handle_response(response: Response) -> Result<Vec<u8>, WebDavError> {
        let status = response.status();
        if status.is_success() {
            response
                .bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| WebDavError {
                    message: format!("Failed to read response: {}", e),
                    status_code: None,
                })
        } else {
            Err(WebDavError {
                message: format!("HTTP error: {}", status),
                status_code: Some(status.as_u16()),
            })
        }
    }

    pub async fn test_connection(&self) -> Result<bool, WebDavError> {
        let url = self.config.url.trim_end_matches('/');

        let response = self
            .client
            .request(Method::OPTIONS, url)
            .header(header::AUTHORIZATION, self.build_auth_header())
            .send()
            .await
            .map_err(|e| WebDavError {
                message: format!("Connection failed: {}", e),
                status_code: None,
            })?;

        Ok(response.status().is_success())
    }

    pub async fn exists(&self, remote_path: &str) -> Result<bool, WebDavError> {
        let url = format!(
            "{}/{}",
            self.config.url.trim_end_matches('/'),
            remote_path.trim_start_matches('/')
        );

        let response = self
            .client
            .head(&url)
            .header(header::AUTHORIZATION, self.build_auth_header())
            .send()
            .await
            .map_err(|e| WebDavError {
                message: format!("HEAD request failed: {}", e),
                status_code: None,
            })?;

        Ok(response.status().is_success())
    }

    pub async fn download(&self, remote_path: &str) -> Result<Vec<u8>, WebDavError> {
        let url = format!(
            "{}/{}",
            self.config.url.trim_end_matches('/'),
            remote_path.trim_start_matches('/')
        );

        let response = self
            .client
            .get(&url)
            .header(header::AUTHORIZATION, self.build_auth_header())
            .send()
            .await
            .map_err(|e| WebDavError {
                message: format!("GET request failed: {}", e),
                status_code: None,
            })?;

        Self::handle_response(response).await
    }

    pub async fn upload(&self, remote_path: &str, data: Vec<u8>) -> Result<(), WebDavError> {
        let url = format!(
            "{}/{}",
            self.config.url.trim_end_matches('/'),
            remote_path.trim_start_matches('/')
        );

        info!("Uploading to WebDAV: {} ({} bytes)", url, data.len());

        let response = self
            .client
            .put(&url)
            .header(header::AUTHORIZATION, self.build_auth_header())
            .header(header::CONTENT_TYPE, "application/json")
            .body(data)
            .send()
            .await
            .map_err(|e| {
                error!("PUT request failed: {}", e);
                WebDavError {
                    message: format!("PUT request failed: {}", e),
                    status_code: None,
                }
            })?;

        let status = response.status();
        debug!("Upload response status: {}", status);

        Self::handle_response(response).await?;
        Ok(())
    }

    pub async fn mkdir(&self, remote_path: &str) -> Result<(), WebDavError> {
        let url = format!(
            "{}/{}",
            self.config.url.trim_end_matches('/'),
            remote_path.trim_start_matches('/')
        );

        info!("Creating WebDAV directory: {}", url);

        let response = self
            .client
            .request(Method::from_bytes(b"MKCOL").unwrap(), &url)
            .header(header::AUTHORIZATION, self.build_auth_header())
            .send()
            .await
            .map_err(|e| {
                error!("MKCOL request failed: {}", e);
                WebDavError {
                    message: format!("MKCOL request failed: {}", e),
                    status_code: None,
                }
            })?;

        let status = response.status();
        debug!("MKCOL response status: {}", status);

        if status.is_success() || status.as_u16() == 405 {
            info!("Directory created or already exists");
            Ok(())
        } else {
            error!("Failed to create directory: {}", status);
            Err(WebDavError {
                message: format!("Failed to create directory: {}", status),
                status_code: Some(status.as_u16()),
            })
        }
    }

    pub async fn ensure_directory(&self, remote_path: &str) -> Result<(), WebDavError> {
        let path = remote_path.trim_matches('/');
        info!("Ensuring directory path: {}", path);

        // Try to create the directory directly first
        // If it fails (parent doesn't exist), create parents recursively
        if self.exists(path).await? {
            info!("Directory already exists: {}", path);
            return Ok(());
        }

        // Try direct MKCOL
        match self.mkdir(path).await {
            Ok(()) => {
                info!("Directory created directly: {}", path);
                return Ok(());
            }
            Err(e) => {
                // If 409 Conflict, parent might not exist, try creating parents
                if e.status_code == Some(409) {
                    info!("Parent directory may not exist, creating recursively");
                } else {
                    return Err(e);
                }
            }
        }

        // Create parent directories recursively
        let parts: Vec<&str> = path.split('/').collect();
        let mut current = String::new();

        for (i, part) in parts.iter().enumerate() {
            if i > 0 {
                current.push('/');
            }
            current.push_str(part);

            if !self.exists(&current).await? {
                info!("Creating directory: {}", current);
                self.mkdir(&current).await?;
            }
        }

        Ok(())
    }
}