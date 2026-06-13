use {
    crate::payload::convert,
    gluesql_core::{
        prelude::{execute, parse, translate},
        store::Planner,
    },
    gluesql_memory_storage::MemoryStorage,
    napi::{Error, Result, Status},
    napi_derive::napi,
};

#[napi]
pub struct Glue {
    storage: Option<MemoryStorage>,
}

impl Default for Glue {
    fn default() -> Self {
        Self::new()
    }
}

#[napi]
impl Glue {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            storage: Some(MemoryStorage::default()),
        }
    }

    #[napi]
    pub fn query(&mut self, sql: String) -> Result<String> {
        let result = futures_executor::block_on(self.query_inner(&sql));
        let payloads = result?;

        serde_json::to_string(&convert(payloads)).map_err(to_napi_error)
    }

    async fn query_inner(&mut self, sql: &str) -> Result<Vec<gluesql_core::prelude::Payload>> {
        let queries = parse(sql).map_err(to_napi_error)?;
        let mut storage = self.storage.take().ok_or_else(|| {
            Error::new(
                Status::GenericFailure,
                "GlueSQL storage is already borrowed".to_owned(),
            )
        })?;
        let result = execute_queries(&mut storage, &queries).await;

        self.storage = Some(storage);

        result
    }
}

#[napi]
pub fn gluesql() -> Glue {
    Glue::new()
}

fn to_napi_error(error: impl ToString) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

async fn execute_queries(
    storage: &mut MemoryStorage,
    queries: &[gluesql_core::sqlparser::ast::Statement],
) -> Result<Vec<gluesql_core::prelude::Payload>> {
    let mut payloads = vec![];

    for query in queries {
        let statement = translate(query).map_err(to_napi_error)?;
        let statement = storage.plan(statement).await.map_err(to_napi_error)?;
        let payload = execute(storage, &statement).await.map_err(to_napi_error)?;

        payloads.push(payload);
    }

    Ok(payloads)
}
